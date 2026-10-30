// Development-only interaction fixture. It never reads or writes a real Profile.
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopApi, ProfileScope, ProfilesSnapshot } from '@hermess/contracts'
import { DesktopProvider } from '../app/DesktopContext'
import { activateWorkspaceEpoch } from '../app/profile-scope/ProfileWorkspace'
import { LanguageProvider } from '../i18n'
import JourneyView from '../features/journey/JourneyView'
import ProfilesView from '../features/profiles/ProfilesView'
import { previewDesktopApi } from './mockDesktopApi'
import '../style.css'

const nodes = [
  { id: 'hermess-desktop-guide', label: 'hermess-desktop-guide', kind: 'skill', category: 'skills', timestamp: 1793232000, useCount: 1 },
  { id: 'memory:welcome', label: '我想一个关于用户首次问候，系统响应', kind: 'memory', category: 'memory', timestamp: 1793145600, useCount: 0 },
]
const contents: Record<string, string> = {
  'hermess-desktop-guide': '---\nname: hermess-desktop-guide\n---\n\n# 使用指南\n这是预览数据。',
  'memory:welcome': '我想一个关于用户首次问候，系统响应',
}

const api: DesktopApi = {
  ...previewDesktopApi,
  profiles: { ...previewDesktopApi.profiles, async dataDirectory(scope) { return { path: `PREVIEW_ONLY/${scope.profile}` } } },
  personalFiles: { ...previewDesktopApi.personalFiles, async read() { return { kind: 'memory' as const, path: 'PREVIEW_ONLY', exists: true, content: '', entries: [], version: 'preview', limit: null, enabled: true } } },
  extensions: {
    ...previewDesktopApi.extensions,
    async request<T>(scope: ProfileScope, operation: string, payload?: Record<string, unknown>): Promise<T> {
      if (operation === 'journey.graph') return { nodes: scope.profile === 'default' ? nodes : [], edges: [] } as T
      if (operation === 'skills.list') return [] as T
      if (operation === 'mcp.list') return { servers: [] } as T
      const id = String((payload as { id?: string })?.id || '')
      if (operation === 'journey.node') return { ok: true, id, kind: nodes.find(node => node.id === id)?.kind, label: nodes.find(node => node.id === id)?.label, content: contents[id] } as T
      if (operation === 'journey.edit') { contents[id] = String((payload as { content: string }).content); return { ok: true } as T }
      if (operation === 'journey.delete') { nodes.splice(nodes.findIndex(node => node.id === id), 1); return { ok: true } as T }
      throw new Error('PREVIEW_ONLY: unavailable operation')
    },
  },
}

const initialProfiles: ProfilesSnapshot = {
  profiles: [{ name: 'default', display_name: '默认 Agent', is_default: true }, { name: 'writer', display_name: '写作 Agent', is_default: false }],
  selected: 'default', gateway_mode: 'single', gateways: [{ profile: 'default', served_profiles: ['default', 'writer'] }], reason: null,
}

function Preview() {
  const agentPreview = new URLSearchParams(location.search).has('agent')
  const [profiles, setProfiles] = React.useState(initialProfiles)
  return <div className={`app-shell${agentPreview ? ' profile-page-shell' : ''}`}>
    <header className="workspace-header"><div><span className="workspace-kicker">PREVIEW_ONLY · 内存模拟</span><h1>学习时间线</h1></div></header>
    <aside className="sidebar"><div className="brand">Hermess</div><div className="primary-nav"><button type="button" className="active">学习时间线</button></div></aside>
    <main className="workspace">{agentPreview
      ? <ProfilesView connected epoch="preview" profiles={profiles} toolsetsRequest={0} profileBusy={false} memoryOpen={false}
          onSelectProfile={async name => { setProfiles(current => ({ ...current, selected: name })) }} onDeleteProfile={async () => ({ settlement_pending: false, refreshed: true })}
          onRenameProfile={async () => ({ display_name: '默认 Agent', refreshed: true })} onMemoryDirtyChange={() => {}}
          onCloseMemory={() => {}} onOpenExtensions={() => {}} onOpenMemory={() => {}} onOpenConfiguration={() => {}}
          onOpenChannels={() => {}} onOpenUsage={() => {}} onNewChat={() => {}} />
      : <JourneyView connected profile="default" epoch="preview" />}</main>
  </div>
}

activateWorkspaceEpoch('preview')
createRoot(document.getElementById('root')!).render(<DesktopProvider api={api}><LanguageProvider><Preview /></LanguageProvider></DesktopProvider>)
