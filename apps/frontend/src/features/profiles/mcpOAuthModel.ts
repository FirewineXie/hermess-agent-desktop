import type { McpOAuthFlow } from '@hermess/contracts'

export const MCP_OAUTH_MAX_POLL_FAILURES = 3

export function isMcpOAuthTerminal(status: string): boolean {
  return ['approved', 'error', 'expired', 'cancelled'].includes(status)
}

export function shouldCancelMcpOAuthOnCleanup(flow: McpOAuthFlow | null, cancelled: boolean): boolean {
  return Boolean(flow && !cancelled && !isMcpOAuthTerminal(flow.status))
}

export function mcpOAuthPollDecision(
  failures: number,
  flow?: McpOAuthFlow,
): { failures: number; terminal: boolean } {
  if (flow) return { failures: 0, terminal: isMcpOAuthTerminal(flow.status) }
  const next = failures + 1
  return { failures: next, terminal: next >= MCP_OAUTH_MAX_POLL_FAILURES }
}
