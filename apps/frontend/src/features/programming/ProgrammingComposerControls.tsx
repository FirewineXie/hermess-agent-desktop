import React from 'react'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import ProgrammingPicker from './ProgrammingPicker'

function PermissionIcon({ mode }: { mode: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{mode === 'request' ? <path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 6-6 6h-1c-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l1 1Z" />
    : mode === 'auto' ? <><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Z" /><path d="m8 10 3 2-3 3m5 0h3" /></>
    : mode === 'custom' ? <><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>
    : <><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Z" /><path d="M12 8v5m0 3v1" /></>}</svg>
}

export function ProgrammingPermissions({ controller, language, onOpenSettings }: {
  controller: ProgrammingController; language: Language; onOpenSettings?: (target?: 'permissions') => void
}) {
  const zh = language === 'zh-CN'
  const { permissionProfiles, permissions, permissionLoading, permissionError, permissionRuntimeMissing, busy, session } = controller
  const modes: Record<string, { label: string; short: string; description: string }> = {
    request: { label: zh ? '请求批准' : 'Ask for approval', short: zh ? '请求批准' : 'Ask approval', description: zh ? '编辑项目外文件和访问互联网时询问你' : 'Ask before changes outside the project or internet access' },
    auto: { label: zh ? '帮我批准' : 'Approve for me', short: zh ? '帮我批准' : 'Auto review', description: zh ? '由 Codex 自动审核，仅风险操作请求你批准' : 'Codex reviews actions; risky operations ask for your approval' },
    full: { label: zh ? '完全访问权限' : 'Full access', short: zh ? '完全访问' : 'Full access', description: zh ? '可不受限制地访问互联网和电脑上的文件' : 'Unrestricted internet and file access on this computer' },
    custom: { label: zh ? '自定义 (config.toml)' : 'Custom (config.toml)', short: zh ? '自定义' : 'Custom', description: zh ? '使用 Hermess 独立 config.toml 中定义的权限' : 'Use permissions from the separate Hermess config.toml' },
  }
  const text = permissionLoading ? (zh ? '读取权限…' : 'Loading…') : permissionRuntimeMissing ? (zh ? '安装运行时' : 'Install runtime')
    : !permissionProfiles.length ? (zh ? '权限不可用' : 'Unavailable') : modes[permissions]?.short || permissions
  return <ProgrammingPicker label={zh ? '编程权限' : 'Programming permissions'} variant="permissions" value={permissions} text={text}
    disabled={busy || session?.status === 'running' || permissionLoading} warning={Boolean(permissionError || permissionRuntimeMissing || permissions === 'full')}
    icon={<PermissionIcon mode={permissions} />}
    options={permissionProfiles.map(row => ({ value: row.id, label: modes[row.id]?.label || row.id, disabled: !row.allowed,
      description: row.allowed ? modes[row.id]?.description : (zh ? '当前运行时策略不允许此模式' : 'Unavailable under current runtime policy'), icon: <PermissionIcon mode={row.id} />, danger: row.id === 'full' }))}
    message={permissionRuntimeMissing ? (zh ? '当前客户端尚未安装编程运行时。请在编程设置中下载后重试。' : 'Install the programming runtime in settings first.') : permissionError || undefined}
    footer={permissionRuntimeMissing && onOpenSettings ? <button type="button" role="menuitem" onClick={() => onOpenSettings?.()}>{zh ? '打开编程设置' : 'Open programming settings'} →</button>
      : permissionError ? <button type="button" role="menuitem" onClick={controller.retryPermissions}>{zh ? '重新读取权限' : 'Reload permissions'}</button>
      : permissionProfiles.length && onOpenSettings ? <button type="button" role="menuitem" onClick={() => onOpenSettings('permissions')}>{zh ? '自定义权限设置' : 'Custom permission settings'} →</button> : undefined}
    onChange={controller.setPermissions} />
}

export function ProgrammingModel({ controller, language }: { controller: ProgrammingController; language: Language }) {
  const zh = language === 'zh-CN'
  const { catalog, session, selectedModelId, busy } = controller
  const value = session?.config_id || selectedModelId
  const options = catalog?.providers.flatMap(provider => provider.models.map(model => ({ value: model.id, label: model.name, group: provider.name }))) || []
  const text = options.find(row => row.value === value)?.label || session?.model || (!catalog ? (zh ? '读取模型…' : 'Loading models…') : (zh ? '请先配置模型' : 'Configure a model'))
  return <ProgrammingPicker label={zh ? '选择编程模型' : 'Select programming model'} value={value} text={text} options={options}
    disabled={busy || session?.status === 'running' || !options.length}
    message={session ? (zh ? '切换模型将新建会话，原历史保留。' : 'Changing models starts a new chat; history is retained.') : undefined} onChange={controller.selectModel} />
}

export function ProgrammingEffort({ controller, language }: { controller: ProgrammingController; language: Language }) {
  const zh = language === 'zh-CN'
  const options = [
    { value: 'low', label: zh ? '低' : 'Low', description: zh ? '更快响应，适合简单任务' : 'Faster responses for simple tasks' },
    { value: 'medium', label: zh ? '中' : 'Medium', description: zh ? '平衡思考深度与速度' : 'Balance depth and speed' },
    { value: 'high', label: zh ? '高' : 'High', description: zh ? '更充分地分析复杂问题' : 'More analysis for complex tasks' },
    { value: 'xhigh', label: zh ? '超高' : 'Extra high', description: zh ? '更深入思考，耗时可能更长' : 'Deeper reasoning; may take longer' },
  ]
  return <ProgrammingPicker label={zh ? '思考强度' : 'Reasoning effort'} value={controller.effort}
    text={`${zh ? '思考' : 'Effort'} · ${options.find(row => row.value === controller.effort)?.label || controller.effort}`}
    options={options} disabled={controller.busy || controller.session?.status === 'running'} onChange={controller.setEffort} />
}
