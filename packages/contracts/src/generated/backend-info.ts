// Generated from schema/backend-info.schema.json. Run pnpm generate:contracts.
export type BackendInfo = {
  port: number
  pid: number
  replay_epoch: string
  connection_id: "local"
} | {
  kind: "remote"
  connection_id: string
  replay_epoch: string
  label: string
}
