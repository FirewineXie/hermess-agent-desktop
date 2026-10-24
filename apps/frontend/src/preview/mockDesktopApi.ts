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
  agentSettings: {
    async schema() { throw previewOnly() },
    async config() { throw previewOnly() },
    async raw() { throw previewOnly() },
    async saveField() { throw previewOnly() },
    async saveRaw() { throw previewOnly() },
    async saveAuxiliary() { throw previewOnly() },
  },
  models: {
    async options() { throw previewOnly() },
    async savedConfig() { throw previewOnly() },
    async endpoints() { throw previewOnly() },
    async loadLists() { return null },
    async saveLists() { throw previewOnly() },
    async addEndpoint() { throw previewOnly() },
    async deleteEndpoint() { throw previewOnly() },
    async setDefault() { throw previewOnly() },
    async checkRuntime() { throw previewOnly() },
    async selectChat() { throw previewOnly() },
  },
  chat: {
    async createSession() { throw previewOnly() },
    async resumeSession() { throw previewOnly() },
    async listSessions() { return { sessions: [] } },
    async submitPrompt() { throw previewOnly() },
    async interruptSession() { throw previewOnly() },
    async replayEvents() { throw previewOnly() },
    async usage() { throw previewOnly() },
    async reasoning() { throw previewOnly() },
    async commands() { throw previewOnly() },
    async executeCommand() { throw previewOnly() },
    async dispatchSkill() { throw previewOnly() },
    async attachFile() { throw previewOnly() },
    async detachImage() { throw previewOnly() },
    async answerRequest() { throw previewOnly() },
  },
  async listen() { return () => {} },
  async open() { return null },
  async onDragDropEvent() { return () => {} },
}
