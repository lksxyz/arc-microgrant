// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";

/// @notice Pull-based escrow for service deposits. Transitions never push funds:
/// every outcome parks the deposit in PayMerchant or PayCustomer, and the owner claims it.
contract BookingEscrow {
    enum Status {
        None,
        Confirmed,
        NoShowClaimed,
        Disputed,
        MerchantCancelled,
        PayMerchant,
        PayCustomer,
        Paid
    }

    struct Booking {
        address customer; // slot 0
        uint96 deposit; //   slot 0
        address merchant; // slot 1
        uint40 scheduledAt; // slot 1
        Status status; //    slot 1
        uint8 reschedules; // slot 1
        uint40 markedAt; //  slot 2: no-show mark, dispute open, or merchant-cancel time
        uint32 claimDelay; // slot 2: seconds after scheduledAt before merchant can claim
    }

    uint40 public constant NO_SHOW_GRACE = 15 minutes;
    uint40 public constant CHECKIN_EARLY = 30 minutes;
    uint40 public constant CHECKIN_WINDOW = 24 hours;
    uint40 public constant CUSTOMER_CANCEL_CUTOFF = 24 hours;
    uint40 public constant NO_SHOW_OBJECTION_WINDOW = 24 hours;
    uint40 public constant ARBITER_SLA = 72 hours;
    uint40 public constant MERCHANT_CANCEL_CHOICE_WINDOW = 72 hours;
    uint40 public constant UNACTED_DEFAULT_WINDOW = 72 hours;
    uint32 public constant MAX_CLAIM_DELAY = 365 days;

    IERC20 public immutable token;
    address public immutable arbiter;

    uint256 public nextBookingId = 1;
    mapping(uint256 => Booking) private _bookings;

    event BookingCreated(uint256 indexed id, address indexed customer, address indexed merchant, uint96 deposit, uint40 scheduledAt);
    event CheckedIn(uint256 indexed id);
    event CustomerCancelled(uint256 indexed id, bool refunded);
    event NoShowClaimed(uint256 indexed id);
    event NoShowObjected(uint256 indexed id);
    event NoShowSettled(uint256 indexed id, bool toMerchant);
    event DisputeResolved(uint256 indexed id, bool toCustomer);
    event MerchantCancelled(uint256 indexed id);
    event Rescheduled(uint256 indexed id, uint40 newScheduledAt);
    event Unacted(uint256 indexed id);
    event RefundParked(uint256 indexed id);
    event Settled(uint256 indexed id, address indexed to, uint96 amount);

    error NotBooking();
    error InvalidStatus();
    error Unauthorized();
    error InvalidAmount();
    error InvalidTime();
    error WindowOpen();
    error WindowClosed();
    error RescheduleUsed();
    error ClaimLocked();
    error TransferFailed();

    constructor(IERC20 token_, address arbiter_) {
        token = token_;
        arbiter = arbiter_;
    }

    function booking(uint256 id) external view returns (Booking memory) {
        return _bookings[id];
    }

    function claimableAt(uint256 id) public view returns (uint256) {
        Booking storage b = _bookings[id];
        return uint256(b.scheduledAt) + b.claimDelay;
    }

    function createBooking(address merchant, uint96 deposit, uint40 scheduledAt, uint32 claimDelay)
        external
        returns (uint256 id)
    {
        if (deposit == 0 || merchant == address(0)) revert InvalidAmount();
        if (scheduledAt <= block.timestamp) revert InvalidTime();
        if (claimDelay > MAX_CLAIM_DELAY) revert InvalidTime();

        _pull(msg.sender, deposit);

        id = nextBookingId;
        unchecked {
            nextBookingId = id + 1;
        }
        _bookings[id] = Booking({
            customer: msg.sender,
            deposit: deposit,
            merchant: merchant,
            scheduledAt: scheduledAt,
            status: Status.Confirmed,
            reschedules: 0,
            markedAt: 0,
            claimDelay: claimDelay
        });
        emit BookingCreated(id, msg.sender, merchant, deposit, scheduledAt);
    }

    /// @notice Merchant confirms the customer showed up. The deposit goes back to the customer.
    function checkIn(uint256 id) external {
        Booking storage b = _confirmedBy(id, msg.sender, false);
        uint256 start = b.scheduledAt;
        if (block.timestamp + CHECKIN_EARLY < start) revert WindowOpen();
        if (block.timestamp >= start + CHECKIN_WINDOW) revert WindowClosed();
        b.status = Status.PayCustomer;
        emit CheckedIn(id);
    }

    /// @notice Customer cancels. Refund if more than the cutoff before start, otherwise forfeit to merchant.
    function cancelByCustomer(uint256 id) external {
        Booking storage b = _confirmedBy(id, msg.sender, true);
        bool refund = uint256(b.scheduledAt) > block.timestamp + CUSTOMER_CANCEL_CUTOFF;
        b.status = refund ? Status.PayCustomer : Status.PayMerchant;
        emit CustomerCancelled(id, refund);
    }

    function markNoShow(uint256 id) external {
        Booking storage b = _confirmedBy(id, msg.sender, false);
        if (block.timestamp < uint256(b.scheduledAt) + NO_SHOW_GRACE) revert WindowOpen();
        b.status = Status.NoShowClaimed;
        b.markedAt = uint40(block.timestamp);
        emit NoShowClaimed(id);
    }

    function objectNoShow(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.NoShowClaimed) revert InvalidStatus();
        if (b.customer != msg.sender) revert Unauthorized();
        if (block.timestamp >= uint256(b.markedAt) + NO_SHOW_OBJECTION_WINDOW) revert WindowClosed();
        b.status = Status.Disputed;
        b.markedAt = uint40(block.timestamp);
        emit NoShowObjected(id);
    }

    /// @notice Anyone can finalize once the objection window passed without objection.
    function finalizeNoShow(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.NoShowClaimed) revert InvalidStatus();
        if (block.timestamp < uint256(b.markedAt) + NO_SHOW_OBJECTION_WINDOW) revert WindowOpen();
        b.status = Status.PayMerchant;
        emit NoShowSettled(id, true);
    }

    function resolveDispute(uint256 id, bool toCustomer) external {
        if (msg.sender != arbiter) revert Unauthorized();
        Booking storage b = _load(id);
        if (b.status != Status.Disputed) revert InvalidStatus();
        if (block.timestamp >= uint256(b.markedAt) + ARBITER_SLA) revert WindowClosed();
        b.status = toCustomer ? Status.PayCustomer : Status.PayMerchant;
        emit DisputeResolved(id, toCustomer);
    }

    /// @notice If the arbiter misses the SLA the dispute defaults to the customer.
    function expireDispute(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.Disputed) revert InvalidStatus();
        if (block.timestamp < uint256(b.markedAt) + ARBITER_SLA) revert WindowOpen();
        b.status = Status.PayCustomer;
        emit DisputeResolved(id, true);
    }

    /// @notice Nobody acted on a confirmed booking long after it started: default to refund.
    function defaultUnacted(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.Confirmed) revert InvalidStatus();
        if (block.timestamp < uint256(b.scheduledAt) + UNACTED_DEFAULT_WINDOW) revert WindowOpen();
        b.status = Status.PayCustomer;
        emit Unacted(id);
    }

    function cancelByMerchant(uint256 id) external {
        Booking storage b = _confirmedBy(id, msg.sender, false);
        if (block.timestamp >= b.scheduledAt) revert WindowClosed();
        b.status = Status.MerchantCancelled;
        b.markedAt = uint40(block.timestamp);
        emit MerchantCancelled(id);
    }

    /// @notice Customer picks a single reschedule (before original start), deposit stays escrowed.
    function reschedule(uint256 id, uint40 newScheduledAt) external {
        Booking storage b = _load(id);
        if (b.status != Status.MerchantCancelled) revert InvalidStatus();
        if (b.customer != msg.sender) revert Unauthorized();
        if (b.reschedules != 0) revert RescheduleUsed();
        if (block.timestamp >= b.scheduledAt) revert WindowClosed();
        if (newScheduledAt <= block.timestamp) revert InvalidTime();
        b.reschedules = 1;
        b.scheduledAt = newScheduledAt;
        b.status = Status.Confirmed;
        b.markedAt = 0;
        emit Rescheduled(id, newScheduledAt);
    }

    function refundAfterMerchantCancel(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.MerchantCancelled) revert InvalidStatus();
        if (b.customer != msg.sender) revert Unauthorized();
        b.status = Status.PayCustomer;
        emit RefundParked(id);
    }

    function autoRefundMerchantCancel(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.MerchantCancelled) revert InvalidStatus();
        if (block.timestamp < uint256(b.markedAt) + MERCHANT_CANCEL_CHOICE_WINDOW) revert WindowOpen();
        b.status = Status.PayCustomer;
    }

    /// @notice Merchant withdraws a parked deposit once the claim delay has passed.
    function claimMerchant(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.PayMerchant) revert InvalidStatus();
        if (b.merchant != msg.sender) revert Unauthorized();
        if (block.timestamp < claimableAt(id)) revert ClaimLocked();
        _payout(id, b, b.merchant);
    }

    /// @notice Customer withdraws a parked refund at any time.
    function claimRefund(uint256 id) external {
        Booking storage b = _load(id);
        if (b.status != Status.PayCustomer) revert InvalidStatus();
        if (b.customer != msg.sender) revert Unauthorized();
        _payout(id, b, b.customer);
    }

    function _load(uint256 id) private view returns (Booking storage b) {
        b = _bookings[id];
        if (b.status == Status.None) revert NotBooking();
    }

    function _confirmedBy(uint256 id, address who, bool asCustomer) private view returns (Booking storage b) {
        b = _load(id);
        if (b.status != Status.Confirmed) revert InvalidStatus();
        if (asCustomer ? b.customer != who : b.merchant != who) revert Unauthorized();
    }

    /// @dev Marks the booking paid and zeroes the deposit before transferring (checks-effects-interactions).
    function _payout(uint256 id, Booking storage b, address to) private {
        uint96 amount = b.deposit;
        b.deposit = 0;
        b.status = Status.Paid;
        if (!token.transfer(to, amount)) revert TransferFailed();
        emit Settled(id, to, amount);
    }

    function _pull(address from, uint256 amount) private {
        if (!token.transferFrom(from, address(this), amount)) revert TransferFailed();
    }
}
