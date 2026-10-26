import type { BundledToolsInventory, DownloadableTool, RuntimeProbe } from '@hermess/contracts'

type BundledTool = BundledToolsInventory['tools'][number]

export type LocalToolRow = {
  key: string
  name: string
  bundled?: BundledTool
  downloadable?: DownloadableTool
  system?: RuntimeProbe
  companions: RuntimeProbe[]
}

function toolKey(name: string): string {
  const key = name.toLowerCase()
  if (key === 'github cli') return 'gh'
  if (key === 'ffprobe') return 'ffmpeg'
  return key
}

export function mergeLocalTools(
  bundled: BundledToolsInventory | null,
  downloadable: DownloadableTool[],
  probes: RuntimeProbe[],
): LocalToolRow[] {
  const rows = new Map<string, LocalToolRow>()
  const rowFor = (name: string) => {
    const key = toolKey(name)
    let row = rows.get(key)
    if (!row) {
      row = { key, name, companions: [] }
      rows.set(key, row)
    }
    return row
  }

  for (const tool of bundled?.tools || []) rowFor(tool.name).bundled = tool
  for (const tool of downloadable) rowFor(tool.name).downloadable = tool
  for (const probe of probes) {
    const row = rowFor(probe.tool)
    if (probe.tool.toLowerCase() === 'ffprobe') row.companions.push(probe)
    else row.system = probe
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}
