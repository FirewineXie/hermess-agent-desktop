export type SharedMetricsConsent = { enabled: boolean; send: boolean; decided: boolean; reask?: boolean; managed: boolean }
export type CheckpointInventory = { sessions: Array<{ session: string; files: number; bytes: number }>; total_bytes: number }
export type RawConfigWriteResult = { verified: boolean; raw: { yaml: string; path: string } }
