export type UpdateChannel = 'stable' | 'rc'

type ParsedVersion = { major: number; minor: number; patch: number; rc: number | null }

export type ReleaseCandidate = {
  version: string
  channel: UpdateChannel
  eligible: boolean
}

export function parseProductVersion(value: string): ParsedVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(value)
  if (!match) return null
  const numbers = match.slice(1).map(part => part === undefined ? null : Number(part))
  if (numbers.some(part => part !== null && !Number.isSafeInteger(part))) return null
  return { major: numbers[0]!, minor: numbers[1]!, patch: numbers[2]!, rc: numbers[3] }
}

export function compareProductVersions(left: string, right: string): number | null {
  const a = parseProductVersion(left)
  const b = parseProductVersion(right)
  if (!a || !b) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key])
  }
  if (a.rc === null) return b.rc === null ? 0 : 1
  if (b.rc === null) return -1
  return Math.sign(a.rc - b.rc)
}

export function defaultUpdateChannel(version: string): UpdateChannel {
  const parsed = parseProductVersion(version)
  return parsed?.rc !== null && parsed !== null ? 'rc' : 'stable'
}

export function selectUpdate(current: string, channel: UpdateChannel, releases: ReleaseCandidate[]): ReleaseCandidate | null {
  let selected: ReleaseCandidate | null = null
  for (const release of releases) {
    const parsed = parseProductVersion(release.version)
    if (!parsed || !release.eligible || (channel === 'stable' && release.channel !== 'stable')) continue
    if ((parsed.rc === null ? 'stable' : 'rc') !== release.channel) continue
    const comparison = compareProductVersions(release.version, current)
    if (comparison === null || comparison <= 0) continue
    if (!selected || compareProductVersions(release.version, selected.version)! > 0) selected = release
  }
  return selected
}
