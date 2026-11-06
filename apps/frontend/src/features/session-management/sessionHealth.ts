import type { SessionManagementHealth } from '@hermess/contracts'

export type SessionHealthAlert = { key: string; title: string; detail?: string | null }

const HEALTHY_GATEWAY_STATES = new Set(['running', 'draining'])
const HEALTHY_PLATFORM_STATES = new Set(['connected', 'ready', 'running', 'healthy', 'disabled'])

export function sessionHealthAlerts(health: SessionManagementHealth | null): SessionHealthAlert[] {
  if (!health) return []
  const alerts: SessionHealthAlert[] = []
  const gatewayState = health.gateway_state || (health.gateway_running ? 'running' : 'stopped')
  if (!health.gateway_running || !HEALTHY_GATEWAY_STATES.has(gatewayState)) {
    alerts.push({ key: 'gateway', title: `Gateway: ${gatewayState}`, detail: health.gateway_exit_reason })
  }
  for (const [name, platform] of Object.entries(health.gateway_platforms || {})) {
    const state = platform.state || 'unknown'
    if (!HEALTHY_PLATFORM_STATES.has(state.toLowerCase())) {
      alerts.push({ key: `platform:${name}`, title: `${name}: ${state}`, detail: platform.error_message || platform.error_code })
    }
  }
  return alerts
}
