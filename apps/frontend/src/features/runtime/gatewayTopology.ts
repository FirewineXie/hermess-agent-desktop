import type { ProfilesSnapshot } from '@hermess/contracts'

export type GatewayTopologyRow = { owner: string; served: string[] }

export function gatewayTopologyRows(snapshot: ProfilesSnapshot | null): GatewayTopologyRow[] {
  if (!snapshot) return []
  return (snapshot.gateways || []).map(gateway => ({
    owner: gateway.profile,
    served: [...new Set([gateway.profile, ...(gateway.served_profiles || [])])],
  }))
}
