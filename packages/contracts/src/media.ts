import type { SessionScope } from './index'

/** A media reference belongs to the session and Gateway that produced it. */
export type MediaScope = SessionScope & { gatewayEpoch: string }
export type MediaKind = 'image' | 'audio' | 'video' | 'file'
export type MediaResource = {
  id: string
  name: string
  kind: MediaKind
  mime: string
  size?: number
  local: boolean
  /** Opaque, window-bound resource URL; never contains a Gateway credential. */
  url: string
}
export type MediaPreview = { kind: 'text' | 'html' | 'unsupported'; content: string; truncated: boolean }
export type MediaApi = {
  prepare(scope: MediaScope, source: string): Promise<MediaResource>
  preview(id: string): Promise<MediaPreview>
  save(id: string): Promise<boolean>
  reveal(id: string): Promise<void>
  release(id: string): Promise<void>
}
