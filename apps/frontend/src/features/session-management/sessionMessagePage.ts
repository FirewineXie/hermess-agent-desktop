import type { SessionManagementMessagePage } from '@hermess/contracts'

export const LOCKED_SESSION_MESSAGE_LIMIT = 500

export function reachedSessionMessageLimit(
  pagination: SessionManagementMessagePage['pagination'] | null | undefined,
): boolean {
  return pagination?.order === 'latest'
    && pagination.limit === LOCKED_SESSION_MESSAGE_LIMIT
    && pagination.returned >= LOCKED_SESSION_MESSAGE_LIMIT
}
