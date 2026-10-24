// Generated from schema/runtime-probe.schema.json. Run pnpm generate:contracts.
export type RuntimeProbe = {
  tool: string
  kind: "runtime" | "command"
  path: string | null
  version: string | null
  usable: boolean
  reason: string
}
