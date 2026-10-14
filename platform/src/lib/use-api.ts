import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { apiFetch } from './api'

export function useApi() {
  const { getAccessToken } = usePrivy()
  return useCallback(
    async <T,>(path: string, opts?: { method?: string; body?: unknown }) => {
      const token = await getAccessToken()
      return apiFetch<T>(path, { ...opts, token })
    },
    [getAccessToken],
  )
}
