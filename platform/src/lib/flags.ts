export const ENFORCE_TIME = import.meta.env.VITE_ENFORCE_TIME === 'true'

export const timeGate = (ok: boolean) => !ENFORCE_TIME || ok
