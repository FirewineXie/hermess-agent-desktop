import type { DesktopApi } from '@hermess/contracts'

const previewOnly = () => new Error('此操作需要桌面客户端；当前是前端预览。')

export const previewDesktopApi: DesktopApi = {
  runtime: {
    async devDefaults() { return { python_path: '', storage_path: '' } },
    async packedDefaults() { return { storage_path: '', initialized: false } },
    async startDev() { throw previewOnly() },
    async startPacked() { throw previewOnly() },
    async ping() { throw previewOnly() },
    async reconnect() { throw previewOnly() },
    async stop() { throw previewOnly() },
    async probeLocalTools() { return [] },
  },
  tools: {
    async listAgentToolsets() { return { toolsets: [] } },
    async listActiveAgentTools() { return { sections: [], total: 0 } },
    async listBundledTools() { return { has_manifest: false, tools: [] } },
  },
  diagnostics: {
    async readLogs() { return '' },
    async recordEvent() {},
  },
  async invoke(command) {
    throw previewOnly()
  },
  async listen() { return () => {} },
  async open() { return null },
  async onDragDropEvent() { return () => {} },
}
