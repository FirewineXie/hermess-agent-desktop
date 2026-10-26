// Generated from schema/bundled-tools-inventory.schema.json. Run pnpm generate:contracts.
export type BundledToolsInventory = {
  has_manifest: boolean
  tools: Array<{
    name: string
    version: string
    path: string
    present: boolean
  }>
}
