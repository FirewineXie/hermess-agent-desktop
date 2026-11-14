export type DashboardPluginManifest = {
  name: string
  label: string
  description: string
  icon: string
  version: string
  tab: { path: string; position?: string | null; override?: string | null; hidden: boolean }
  slots: string[]
  entry: string
  css?: string | null
  integrity?: string | null
  has_api: boolean
  source: string
}

export type DashboardPluginAssets = { script: 'loading' | 'loaded' | 'failed'; styleFailed: boolean }

export type DashboardPluginDefinition = {
  manifest: DashboardPluginManifest
  pageRegistered: boolean
  registeredSlots: string[]
  status: 'loading' | 'registered' | 'unregistered' | 'asset-failed'
  styleFailed: boolean
}

export function dashboardPluginDefinition(
  manifest: DashboardPluginManifest,
  assets: DashboardPluginAssets | undefined,
  pageRegistered: boolean,
  registeredSlots: string[],
): DashboardPluginDefinition {
  const status = assets?.script === 'failed' ? 'asset-failed'
    : pageRegistered || registeredSlots.length ? 'registered'
      : assets?.script === 'loaded' ? 'unregistered' : 'loading'
  return { manifest, pageRegistered, registeredSlots, status, styleFailed: assets?.styleFailed ?? false }
}

export function dashboardPluginEntryKey(manifest: DashboardPluginManifest) {
  return JSON.stringify([manifest.entry, manifest.css, manifest.integrity, manifest.version, manifest.source])
}
