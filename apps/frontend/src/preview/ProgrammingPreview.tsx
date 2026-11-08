import React from 'react'
import { createRoot } from 'react-dom/client'
import type { CodingSession, CodingCommand } from '@hermess/contracts'
import { DesktopProvider } from '../app/DesktopContext'
import { previewDesktopApi } from './mockDesktopApi'
import ProgrammingSessions from '../features/programming/ProgrammingSessions'
import ProgrammingChat from '../features/programming/ProgrammingChat'
import { useProgrammingController } from '../features/programming/useProgrammingController'
import ProgrammingProfileSyncDialog from '../features/programming/ProgrammingProfileSyncDialog'
import '../style.css'
import '../features/desktop/dark-theme.css'
import '../features/desktop/appearance.css'

// Explicit, reproducible preview fixtures; never connected to a native runtime or filesystem.
const session: CodingSession = {
  id: 'preview', project_id: 'project', title: '预览会话', cwd: '/preview/project', config_id: 'preview-model', model: 'ark-code-latest', thread_id: null,
  status: 'completed', output: '', error: '', activity: '', approval: null,
  context: { effort: 'medium', used_tokens: 42000, context_window: 200000 },
  messages: [
    { role: 'user', text: '请检查这个项目的聊天布局，并说明验证结果。', images: [] },
    { role: 'assistant', text: '已检查消息区和输入框。\n\n用户消息位于右侧，助手回复位于左侧；输入框上方显示项目与 Git 分支，底部显示审批策略和模型上下文用量。\n\n```ts\nconst result = await checkLayout()\n```', images: [] },
    { role: 'user', text: '长路径和窄窗口也要检查。', images: [] },
  ],
}
const scenario = new URLSearchParams(window.location.search).get('scenario')
if (['goal-active', 'goal-paused', 'goal-stale', 'goal-long', 'goal-edit-error'].includes(scenario || '')) {
  const active = !['goal-paused', 'goal-stale'].includes(scenario || '')
  session.status = active ? 'running' : 'completed'
  session.context = { mode: 'default', active_command: active ? 'goal' : null, goal: {
    threadId: 'PREVIEW_ONLY', objective: scenario === 'goal-long' ? '检查长目标在窄窗口中的显示，保留完整目标和可操作的编辑入口。'.repeat(12) : '修复聊天交互，并验证 Windows 与 macOS 的共用逻辑。',
    status: scenario === 'goal-paused' ? 'paused' : 'active', tokenBudget: 50000, tokensUsed: 1200, timeUsedSeconds: 63, createdAt: 1, updatedAt: 1,
  } }
}
if (scenario === 'plan-state') session.context = { mode: 'plan' }
if (scenario === 'review-running' || scenario === 'compact-running') {
  session.status = 'running'; session.context = { active_command: scenario === 'review-running' ? 'review' : 'compact' }
}
if (scenario === 'command-question') {
  session.status = 'running'
  session.context = { mode: 'plan', question: { id: 'PREVIEW_ONLY_QUESTION', questions: [{ id: 'approach', header: '实现方式', question: '选择一种实现方式', isOther: true, isSecret: false, options: [{ label: 'A', description: '第一种方案' }, { label: 'B', description: '第二种方案' }] }] } }
}
if (scenario === 'tools' || scenario === 'approval') {
  session.messages = [
    { role: 'user', text: '给我写一个贪吃蛇小游戏', images: [] },
    { role: 'assistant', text: '我先检查项目目录，然后实现一个开箱即玩的贪吃蛇游戏。', images: [] },
    { role: 'assistant', text: '', images: [], tool: { id: 'cmd', type: 'commandExecution', status: 'completed', summary: 'Get-ChildItem -Force', cwd: '/preview/project', detail: '', output: 'src/\npackage.json', exit_code: 0 } },
    { role: 'assistant', text: '', images: [], tool: { id: 'file', type: 'fileChange', status: 'completed', summary: '', detail: 'src/snake.ts\n+export function startGame() {}', output: '', changes: [{ path: '/preview/project/src/snake.ts', kind: 'add', added: 122, removed: 0 }] } },
    { role: 'assistant', text: '', images: [], tool: { id: 'build', type: 'commandExecution', status: 'completed', summary: 'pnpm build', cwd: '/preview/project', detail: '', output: 'Build succeeded', exit_code: 0 } },
    { role: 'assistant', text: '游戏已实现，使用方向键控制，空格暂停。构建检查已通过。', images: [] },
  ]
  if (scenario === 'approval') {
    session.status = 'running'
    session.approval = { id: 'preview-approval', command: 'pnpm install', description: '预览审批：下载当前项目所需依赖。', options: [
      { id: 'once', kind: 'once', detail: '' }, { id: 'session', kind: 'session', detail: '' },
      { id: 'rule', kind: 'command_rule', detail: '["pnpm", "install"]' },
      { id: 'deny', kind: 'deny', detail: '' }, { id: 'cancel', kind: 'cancel', detail: '' },
    ] }
  }
}
if (scenario === 'unknown') session.context = null
if (scenario === 'tools') session.messages[0].timing = { started_at_ms: 1000, elapsed_ms: 3723000 }
if (scenario === 'timing') {
  session.status = 'running'
  session.messages[session.messages.length - 1].timing = { started_at_ms: Date.now() - 3723000 }
}
if (scenario === 'long') session.cwd = '/preview/' + 'long-directory-name/'.repeat(10) + 'project'
if (scenario === 'git-running') session.status = 'running'
let sidebarRows: CodingSession[] = [session, { ...session, id: 'long', title: '这是用于检查侧栏长标题截断和操作按钮可见性的编程会话'.repeat(3) }, { ...session, id: 'running', title: '正在运行的编程任务', status: 'running' }]
let previewBranch = 'feature/preview-layout'
const branchState = () => ({ state: (scenario === 'no-git' ? 'not_repository' : scenario === 'git-missing' ? 'unavailable' : 'repository') as 'repository' | 'not_repository' | 'unavailable',
  branch: scenario === 'no-git' ? null : scenario === 'detached' && previewBranch === 'feature/preview-layout' ? 'abcdef01' : previewBranch,
  detached: scenario === 'detached' && previewBranch === 'feature/preview-layout', branches: scenario === 'no-git' || scenario === 'unborn' ? [] : ['feature/preview-layout', 'main', 'feature/another-branch'] })
let skillLoads = 0
let commandAttempts = 0
const api = { ...previewDesktopApi, coding: { ...previewDesktopApi.coding,
  command: async (_id: string, command: CodingCommand) => {
    if (scenario === 'command-error' && commandAttempts++ === 0) throw new Error('PREVIEW_ONLY: command rejected')
    if (scenario === 'goal-edit-error' && command.type === 'goal' && command.action === 'update' && commandAttempts++ === 0) throw new Error('PREVIEW_ONLY: edit rejected')
    const context = session.context ||= {}
    if (command.type === 'plan') context.mode = command.mode
    if (command.type === 'goal') {
      if (command.action === 'set') context.goal = { threadId: 'PREVIEW_ONLY', objective: command.objective || '', status: 'active', tokenBudget: command.token_budget || null, tokensUsed: 13, timeUsedSeconds: 61, createdAt: 1, updatedAt: 1 }
      if (command.action === 'update' && context.goal) context.goal.objective = command.objective || ''
      if (command.action === 'pause' && context.goal) context.goal.status = 'paused'
      if (command.action === 'resume' && context.goal) context.goal.status = 'active'
      if (command.action === 'clear') context.goal = null
      session.status = context.goal?.status === 'active' ? 'running' : 'completed'
      context.active_command = session.status === 'running' ? 'goal' : null
    }
    session.activity = `PREVIEW_ONLY: ${JSON.stringify(command)}`
  },
  answer: async (_id: string, requestId: string, answers: Record<string, { answers: string[] }>) => {
    session.activity = `PREVIEW_ONLY: ${JSON.stringify({ requestId, answers })}`
    if (session.context) session.context.question = null
  },
  stop: async () => { session.status = 'stopped'; if (session.context?.goal) session.context.goal.status = 'paused' },
  skills: async () => {
    if (scenario === 'skills-retry' && skillLoads++ === 0) throw new Error('PREVIEW_ONLY: skill discovery failure')
    return { skills: [{ name: 'preview-skill', description: 'PREVIEW_ONLY · 项目技能', path: '/preview/project/.agents/skills/preview-skill/SKILL.md', enabled: true }], errors: [] }
  },
  approve: async (_id: string, _requestId: string, optionId: string) => {
    const option = session.approval?.options.find(option => option.id === optionId)
    if (!option) throw new Error('PREVIEW_ONLY: approval option not offered')
    session.activity = `PREVIEW_ONLY: ${option.kind}`
    session.approval = null; session.status = 'completed'
  },
  runtime: async () => ({ tag: 'PREVIEW_ONLY', version: 'preview', supported: true, state: (scenario === 'missing' ? 'missing' : 'installed') as 'missing' | 'installed', downloaded: 0, total: 0 }),
  permissionProfiles: async () => { if (scenario === 'error') throw new Error('预览：权限读取失败，请重试。'); return ['request', 'auto', 'full', 'custom'].map(id => ({ id, allowed: true })) },
  profileProviders: async (profile: string) => profile === 'empty' ? [] : [
    { id: `${profile}:first`, name: '提供商甲（预览）', base_url: 'https://first.invalid/v1', models: ['first-model'] },
    { id: `${profile}:second`, name: '提供商乙（预览）', base_url: 'https://second.invalid/v1', models: ['second-model-one', 'second-model-two'] },
  ],
  projects: async () => [{ id: 'project', name: scenario === 'long' ? '很长的项目名称用于验证窄窗口是否溢出'.repeat(5) : '示例项目（预览）', cwd: session.cwd, legacy_cwds: [session.cwd] }],
  sessions: async () => scenario === 'sidebar' ? sidebarRows : [session], read: async (id: string) => sidebarRows.find(row => row.id === id) || session,
  archive: async (id: string, archived: boolean) => { const row = sidebarRows.find(row => row.id === id)!; row.archived = archived; return { ...row } },
  remove: async (id: string) => { sidebarRows = sidebarRows.filter(row => row.id !== id) },
  branch: async () => ({ ...branchState(), branch: scenario === 'long' ? 'feature/' + 'long-branch-name-'.repeat(12) : branchState().branch }),
  switchBranch: async (_cwd: string, branch: string) => {
    if (scenario === 'git-conflict') return { ...branchState(), switch_error: 'rejected' as const }
    previewBranch = branch
    return branchState()
  },
  catalog: async () => ({ revision: 'PREVIEW_ONLY', enabled: false, effort: 'medium', default_model: 'preview-model', providers: [{ id: 'preview', name: '预览提供方', region: 'custom' as const, base_url: '', has_key: false, models: [{ id: 'preview-model', name: 'ark-code-latest' }] }] }),
} }
function SyncPreview() {
  const [profile, setProfile] = React.useState('default')
  const [result, setResult] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return <main className="programming-settings">
    <h1>PREVIEW_ONLY · 单供应商同步 · 模拟数据</h1>
    <output data-testid="sync-result">{result}</output>
    <ProgrammingProfileSyncDialog language="zh-CN" profiles={[{ name: 'default' }, { name: 'other' }, { name: 'empty' }]} profile={profile} busy={busy} error="" onSelect={setProfile} onClose={() => setResult('closed')} onSync={provider => { setResult(JSON.stringify({ profile, provider })); setBusy(true) }} />
  </main>
}
function SidebarPreview() {
  const controller = useProgrammingController('zh-CN', session.cwd, false)
  return <aside className="sidebar" style={{ width: Number(new URLSearchParams(location.search).get('width')) || 236, height: '100vh' }}><p>PREVIEW_ONLY · 模拟侧栏</p><div className="sidebar-sessions"><ProgrammingSessions controller={controller} language="zh-CN" active onOpen={id => { if (id) void controller.select(id) }} /></div></aside>
}
function Preview() {
  const controller = useProgrammingController('zh-CN', session.cwd)
  React.useEffect(() => { if (scenario !== 'directories') controller.setSession(session) }, [])
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <p style={{ margin: '10px 32px', color: '#66758c', fontSize: 13 }}>编程聊天 · PREVIEW_ONLY 模拟数据</p>
    <ProgrammingChat language="zh-CN" controller={controller} />
  </main>
}
createRoot(document.getElementById('root')!).render(<DesktopProvider api={api}>{scenario === 'sidebar' ? <SidebarPreview /> : scenario === 'sync' ? <SyncPreview /> : <Preview />}</DesktopProvider>)
