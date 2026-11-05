import type { SessionRow, View } from '../../app/types'
import { settingsCategories, settingsPages, type SettingsPage } from '../settings/model'
import type { DashboardPluginManifest } from '../dashboard-plugins/DashboardPluginHost'

export type PaletteItem = {
  id: string
  kind: 'action' | 'page' | 'setting' | 'session'
  title: string
  detail: string
  keywords: string
  target: { kind: 'action'; id: 'new-chat' | 'refresh-sessions' } | { kind: 'page'; view: View } | { kind: 'plugin'; name: string } | { kind: 'setting'; page: SettingsPage } | { kind: 'session'; profile: string; id: string }
}

const pages: Array<{ view: View; zh: string; en: string }> = [
  { view: 'chat', zh: '当前聊天', en: 'Current chat' },
  { view: 'sessions', zh: '会话管理', en: 'Sessions' },
  { view: 'files', zh: '文件管理', en: 'Files' },
  { view: 'workspaces', zh: '工作区', en: 'Workspaces' },
  { view: 'extensions', zh: '扩展中心', en: 'Extension Center' },
  { view: 'scheduled', zh: '定时任务', en: 'Scheduled tasks' },
  { view: 'personal-tasks', zh: '持续任务', en: 'Ongoing tasks' },
  { view: 'webhooks', zh: 'Webhooks', en: 'Webhooks' },
  { view: 'tools', zh: '工具与能力', en: 'Tools and capabilities' },
  { view: 'usage', zh: '用量统计', en: 'Usage' },
  { view: 'profiles', zh: '角色与 Profile', en: 'Roles and profiles' },
  { view: 'channels', zh: '渠道', en: 'Channels' },
  { view: 'memory', zh: '个人文件与记忆', en: 'Personal files and memory' },
  { view: 'journey', zh: '学习时间线', en: 'Learning timeline' },
]

export function paletteItems(input: {
  language: string
  connected: boolean
  diagnosticsUnlocked: boolean
  selectedProfile: string | null
  sessions: SessionRow[]
  otherProfileSessions: Record<string, SessionRow[]>
  profileNames: Record<string, string>
  dashboardPlugins: DashboardPluginManifest[]
}): PaletteItem[] {
  const zh = input.language === 'zh-CN'
  const result: PaletteItem[] = [
    { id: 'action:new-chat', kind: 'action', title: zh ? '新建聊天' : 'New chat', detail: zh ? '操作' : 'Action', keywords: 'new chat 新建 会话', target: { kind: 'action', id: 'new-chat' } },
    ...(input.connected ? [{ id: 'action:refresh-sessions', kind: 'action' as const, title: zh ? '刷新会话列表' : 'Refresh sessions', detail: zh ? '操作' : 'Action', keywords: 'refresh reload 刷新 会话', target: { kind: 'action' as const, id: 'refresh-sessions' as const } }] : []),
    ...pages.map(page => ({ id: `page:${page.view}`, kind: 'page' as const, title: zh ? page.zh : page.en, detail: zh ? '页面' : 'Page', keywords: `${page.zh} ${page.en} ${page.view}`, target: { kind: 'page' as const, view: page.view } })),
    ...input.dashboardPlugins.filter(plugin => !plugin.tab.hidden && !plugin.tab.override).map(plugin => ({ id: `plugin:${plugin.name}`, kind: 'page' as const, title: plugin.label, detail: zh ? '插件页面' : 'Plugin page', keywords: `${plugin.label} ${plugin.name} ${plugin.description}`, target: { kind: 'plugin' as const, name: plugin.name } })),
    ...settingsPages.filter(page => page.id !== 'diagnostics' || input.diagnosticsUnlocked).map(page => {
      const category = settingsCategories.find(item => item.id === page.category)
      return { id: `setting:${page.id}`, kind: 'setting' as const, title: zh ? page.zh : page.en, detail: `${zh ? '设置' : 'Settings'} · ${zh ? category?.zh : category?.en}`, keywords: `${page.zh} ${page.en} ${page.id} ${category?.zh || ''} ${category?.en || ''}`, target: { kind: 'setting' as const, page: page.id } }
    }),
  ]
  if (!input.connected) return result
  const groups = { ...input.otherProfileSessions }
  if (input.selectedProfile) groups[input.selectedProfile] = input.sessions
  for (const [profile, sessions] of Object.entries(groups)) {
    for (const session of sessions) {
      const title = session.title || session.preview || session.id
      result.push({
        id: `session:${profile}:${session.id}`, kind: 'session', title,
        detail: `${zh ? '会话' : 'Session'} · ${input.profileNames[profile] || profile}`,
        keywords: `${title} ${session.preview || ''} ${session.id} ${profile} ${input.profileNames[profile] || ''}`,
        target: { kind: 'session', profile, id: session.id },
      })
    }
  }
  return result
}

export function searchPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items.filter(item => item.kind !== 'session').slice(0, 24)
  return items.map((item, index) => {
    const title = item.title.toLocaleLowerCase()
    const content = `${item.title} ${item.detail} ${item.keywords}`.toLocaleLowerCase()
    if (!words.every(word => content.includes(word))) return null
    const score = words.reduce((total, word) => total + (title === word ? 10 : title.startsWith(word) ? 5 : title.includes(word) ? 2 : 0), 0)
    return { item, index, score }
  }).filter((row): row is { item: PaletteItem; index: number; score: number } => row !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 60).map(row => row.item)
}
