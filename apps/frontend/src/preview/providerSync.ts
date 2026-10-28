import type { CustomEndpoint, ProviderSyncTarget } from '@hermess/contracts'

export function syncPreviewProvider(source: CustomEndpoint | undefined, target: CustomEndpoint[], profile: string, apply: boolean, replace: boolean): ProviderSyncTarget {
  const base = { profile, configCopied: false, credentialCopied: false, requiresReauthentication: true }
  if (!source) return { ...base, status: 'failed' }
  const matchingId = target.find(item => item.id === source.id)
  const matchingName = target.find(item => item.name === source.name)
  const matchingAddress = target.find(item => item.base_url === source.base_url)
  const existing = matchingId || matchingName || matchingAddress
  const conflictKind = matchingId ? 'id' : matchingName ? 'name' : matchingAddress ? 'address' : undefined
  if (existing && (!replace || conflictKind === 'address')) {
    const changedFields = (['name', 'base_url', 'model', 'models', 'discover_models'] as const)
      .filter(key => JSON.stringify(existing[key]) !== JSON.stringify(source[key]))
    return { ...base, status: 'conflict', conflictKind, changedFields }
  }
  if (!apply) return { ...base, status: 'ready' }
  const copied = { ...structuredClone(source), is_current: existing?.is_current || false }
  if (existing) target.splice(target.indexOf(existing), 1, { ...copied, id: existing.id })
  else target.push(copied)
  return { ...base, status: 'copied', configCopied: true }
}
