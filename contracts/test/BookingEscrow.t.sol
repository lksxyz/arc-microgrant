// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BookingEscrow} from "../src/BookingEscrow.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract BookingEscrowTest is Test {
    BookingEscrow internal escrow;
    MockUSDC internal usdc;

    address internal arbiter = makeAddr("arbiter");
    address internal merchant = makeAddr("merchant");
    address internal customer = makeAddr("customer");
    uint96 internal constant DEPOSIT = 10e6;
    uint32 internal constant DELAY = 1 days;
    uint40 internal start;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new BookingEscrow(IERC20(address(usdc)), arbiter);
        usdc.mint(customer, 1_000e6);
        vm.prank(customer);
        usdc.approve(address(escrow), type(uint256).max);
        start = uint40(block.timestamp + 3 days);
    }

    function _book() internal returns (uint256 id) {
        vm.prank(customer);
        id = escrow.createBooking(merchant, DEPOSIT, start, DELAY);
    }

    function _status(uint256 id) internal view returns (BookingEscrow.Status) {
        return escrow.booking(id).status;
    }

    function _noShowClaimed(uint256 id) internal {
        vm.warp(start + 15 minutes);
        vm.prank(merchant);
        escrow.markNoShow(id);
    }

    function test_createBooking_escrowsDeposit() public {
        uint256 id = _book();
        assertEq(id, 1);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.Confirmed));
        assertEq(escrow.claimableAt(id), start + DELAY);
    }

    function test_createBooking_rejectsBadInput() public {
        vm.startPrank(customer);
        vm.expectRevert(BookingEscrow.InvalidAmount.selector);
        escrow.createBooking(merchant, 0, start, DELAY);
        vm.expectRevert(BookingEscrow.InvalidAmount.selector);
        escrow.createBooking(address(0), DEPOSIT, start, DELAY);
        vm.expectRevert(BookingEscrow.InvalidTime.selector);
        escrow.createBooking(merchant, DEPOSIT, uint40(block.timestamp), DELAY);
        vm.expectRevert(BookingEscrow.InvalidTime.selector);
        escrow.createBooking(merchant, DEPOSIT, start, 366 days);
        vm.stopPrank();
    }

    function test_checkIn_refundsCustomer() public {
        uint256 id = _book();
        vm.warp(start - 30 minutes);
        vm.prank(merchant);
        escrow.checkIn(id);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.PayCustomer));
        assertEq(usdc.balanceOf(customer), 1_000e6 - DEPOSIT);

        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.InvalidStatus.selector);
        escrow.claimMerchant(id);

        vm.prank(customer);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(customer), 1_000e6);
        assertEq(usdc.balanceOf(merchant), 0);
    }

    function test_checkIn_tooEarly_reverts() public {
        uint256 id = _book();
        vm.warp(start - 31 minutes);
        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.WindowOpen.selector);
        escrow.checkIn(id);
    }

    function test_checkIn_afterWindow_reverts() public {
        uint256 id = _book();
        vm.warp(start + 24 hours);
        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.WindowClosed.selector);
        escrow.checkIn(id);
    }

    function test_checkIn_blocksCustomerCancelAndNoShow() public {
        uint256 id = _book();
        vm.warp(start - 20 minutes);
        vm.prank(merchant);
        escrow.checkIn(id);

        vm.prank(customer);
        vm.expectRevert(BookingEscrow.InvalidStatus.selector);
        escrow.cancelByCustomer(id);

        vm.warp(start + 15 minutes);
        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.InvalidStatus.selector);
        escrow.markNoShow(id);
    }

    function test_customerCancel_moreThan24h_parksRefund_claimableAnytime() public {
        uint256 id = _book();
        vm.prank(customer);
        escrow.cancelByCustomer(id);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.PayCustomer));
        assertEq(usdc.balanceOf(customer), 1_000e6 - DEPOSIT);

        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.InvalidStatus.selector);
        escrow.claimMerchant(id);

        vm.prank(customer);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(customer), 1_000e6);
    }

    function test_customerCancel_within24h_parksForMerchant() public {
        uint256 id = _book();
        vm.warp(start - 23 hours);
        vm.prank(customer);
        escrow.cancelByCustomer(id);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.PayMerchant));

        vm.warp(start + DELAY);
        vm.prank(merchant);
        escrow.claimMerchant(id);
        assertEq(usdc.balanceOf(merchant), DEPOSIT);
    }

    function test_noShow_unobjected_parksForMerchant() public {
        uint256 id = _book();
        _noShowClaimed(id);
        vm.expectRevert(BookingEscrow.WindowOpen.selector);
        escrow.finalizeNoShow(id);

        vm.warp(start + 15 minutes + 24 hours);
        escrow.finalizeNoShow(id);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.PayMerchant));

        vm.warp(start + 15 minutes + 24 hours + DELAY);
        vm.prank(merchant);
        escrow.claimMerchant(id);
        assertEq(usdc.balanceOf(merchant), DEPOSIT);
    }

    function test_noShow_markTooEarly_reverts() public {
        uint256 id = _book();
        vm.warp(start + 14 minutes);
        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.WindowOpen.selector);
        escrow.markNoShow(id);
    }

    function test_noShow_objected_arbiterRefunds() public {
        uint256 id = _book();
        _noShowClaimed(id);
        vm.prank(customer);
        escrow.objectNoShow(id);

        vm.prank(arbiter);
        escrow.resolveDispute(id, true);
        vm.prank(customer);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(customer), 1_000e6);
    }

    function test_noShow_objectAfterWindow_reverts() public {
        uint256 id = _book();
        _noShowClaimed(id);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(customer);
        vm.expectRevert(BookingEscrow.WindowClosed.selector);
        escrow.objectNoShow(id);
    }

    function test_dispute_arbiterSla_expiresToCustomer() public {
        uint256 id = _book();
        _noShowClaimed(id);
        vm.prank(customer);
        escrow.objectNoShow(id);

        vm.warp(block.timestamp + 72 hours);
        vm.prank(arbiter);
        vm.expectRevert(BookingEscrow.WindowClosed.selector);
        escrow.resolveDispute(id, false);

        escrow.expireDispute(id);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.PayCustomer));
    }

    function test_dispute_onlyArbiterResolves() public {
        uint256 id = _book();
        _noShowClaimed(id);
        vm.prank(customer);
        escrow.objectNoShow(id);
        vm.prank(merchant);
        vm.expectRevert(BookingEscrow.Unauthorized.selector);
        escrow.resolveDispute(id, false);
    }

    function test_merchantCancel_customerRefunds() public {
        uint256 id = _book();
        vm.prank(merchant);
        escrow.cancelByMerchant(id);
        vm.prank(customer);
        escrow.refundAfterMerchantCancel(id);
        vm.prank(customer);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(customer), 1_000e6);
    }

    function test_merchantCancel_customerReschedulesOnce() public {
        uint256 id = _book();
        vm.prank(merchant);
        escrow.cancelByMerchant(id);

        uint40 newStart = start + 1 days;
        vm.prank(customer);
        escrow.reschedule(id, newStart);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.Confirmed));
        assertEq(escrow.claimableAt(id), newStart + DELAY);

        vm.prank(merchant);
        escrow.cancelByMerchant(id);
        vm.prank(customer);
        vm.expectRevert(BookingEscrow.RescheduleUsed.selector);
        escrow.reschedule(id, newStart + 1 days);
    }

    function test_merchantCancel_reschedulePastStart_reverts() public {
        uint256 id = _book();
        vm.prank(merchant);
        escrow.cancelByMerchant(id);
        vm.warp(start);
        vm.prank(customer);
        vm.expectRevert(BookingEscrow.WindowClosed.selector);
        escrow.reschedule(id, start + 1 days);
    }

    function test_merchantCancel_defaultsToRefundAfter72h() public {
        uint256 id = _book();
        vm.prank(merchant);
        escrow.cancelByMerchant(id);
        vm.expectRevert(BookingEscrow.WindowOpen.selector);
        escrow.autoRefundMerchantCancel(id);
        vm.warp(block.timestamp + 72 hours);
        escrow.autoRefundMerchantCancel(id);
        assertEq(uint8(_status(id)), uint8(BookingEscrow.Status.PayCustomer));
    }

    function test_unacted_defaultsToRefund() public {
        uint256 id = _book();
        vm.warp(start + 72 hours - 1);
        vm.expectRevert(BookingEscrow.WindowOpen.selector);
        escrow.defaultUnacted(id);
        vm.warp(start + 72 hours);
        escrow.defaultUnacted(id);
        vm.prank(customer);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(customer), 1_000e6);
    }

    function test_cannotClaimTwice() public {
        uint256 id = _book();
        vm.prank(customer);
        escrow.cancelByCustomer(id);
        vm.prank(customer);
        escrow.claimRefund(id);
        vm.prank(customer);
        vm.expectRevert(BookingEscrow.InvalidStatus.selector);
        escrow.claimRefund(id);
    }

    function test_unknownBooking_reverts() public {
        vm.expectRevert(BookingEscrow.NotBooking.selector);
        escrow.cancelByCustomer(999);
    }

    function testFuzz_escrowSolvent(uint8 action, uint32 warpSeed) public {
        uint256 id = _book();
        vm.warp(block.timestamp + (warpSeed % (5 days)));
        uint8 a = action % 4;
        if (a == 0) {
            vm.prank(merchant);
            try escrow.checkIn(id) {} catch {}
        } else if (a == 1) {
            vm.prank(customer);
            try escrow.cancelByCustomer(id) {} catch {}
        } else if (a == 2) {
            vm.prank(merchant);
            try escrow.markNoShow(id) {} catch {}
            vm.warp(block.timestamp + 24 hours);
            try escrow.finalizeNoShow(id) {} catch {}
        } else {
            vm.warp(start + 72 hours);
            try escrow.defaultUnacted(id) {} catch {}
        }
        vm.warp(block.timestamp + 10 days);
        vm.prank(merchant);
        try escrow.claimMerchant(id) {} catch {}
        vm.prank(customer);
        try escrow.claimRefund(id) {} catch {}
        assertEq(usdc.balanceOf(address(escrow)) + usdc.balanceOf(customer) + usdc.balanceOf(merchant), 1_000e6);
    }
}
