import React from 'react'
import { isDesktopFailure } from '@hermess/contracts'
import type { Language } from '../../i18n'
import { describeError } from '../../app/desktopErrors'
import { useCodingSettings } from './useCodingSettings'
import ProgrammingMcpSettings from './ProgrammingMcpSettings'
import ProgrammingSkillSettings from './ProgrammingSkillSettings'
import ProgrammingInstructionSettings from './ProgrammingInstructionSettings'
import './programmingSettings.css'
import './programming.css'

export type ProgrammingConfigurationPage = 'programming-mcp' | 'programming-skills' | 'programming-instructions' | 'programming-context'
export default function ProgrammingConfiguration({ page, language, onDirtyChange, onBusyChange, onSaved, onOpenConfig }: {
  page: ProgrammingConfigurationPage; language: Language; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void; onSaved: () => void; onOpenConfig: () => void
}) {
  const zh = language === 'zh-CN'
  const c = useCodingSettings(onDirtyChange, onBusyChange, onSaved)
  const title = { 'programming-mcp': 'MCP Servers', 'programming-skills': 'Skills', 'programming-instructions': zh ? '指令与项目' : 'Instructions and projects', 'programming-context': zh ? '上下文' : 'Context' }[page]
  const context = c.draft?.context
  const readOnly = page === 'programming-mcp' || page === 'programming-skills'
  const number = (key: 'model_context_window' | 'model_auto_compact_token_limit' | 'tool_output_token_limit' | 'model_post_turn_compact_threshold_percent', label: string, max = 100000000) => <label>{label}<input type="number" min={key === 'model_post_turn_compact_threshold_percent' ? 0 : 1} max={max} placeholder={zh ? '运行时默认' : 'Runtime default'} value={context?.[key] ?? ''} onChange={event => c.change({ context: { ...context!, [key]: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
  return <section className="programming-settings programming-configuration" aria-label={title}>
    <div className="programming-section-title"><div><h2>{title}</h2><p>{zh ? '所有 Profile 共用。保存后从下一轮编程任务生效，恢复的会话也使用新配置；运行中的任务保持原配置。' : 'Shared across Profiles. Saved settings apply from the next turn, including resumed chats. Running turns keep their current settings.'}</p></div></div>
    {c.draft ? <form onSubmit={event => { event.preventDefault(); if (!readOnly) void c.save() }}>
      <fieldset disabled={c.busy} className="programming-settings-root">
        {page === 'programming-mcp' && <ProgrammingMcpSettings key={c.reloadKey} controller={c} zh={zh} />}
        {page === 'programming-skills' && <ProgrammingSkillSettings key={c.reloadKey} controller={c} zh={zh} />}
        {page === 'programming-instructions' && <ProgrammingInstructionSettings key={c.reloadKey} controller={c} zh={zh} />}
        {page === 'programming-context' && <div className="programming-settings-fields">
          {number('model_context_window', zh ? '模型上下文窗口（Token）' : 'Model context window (tokens)')}
          {number('model_auto_compact_token_limit', zh ? '自动压缩阈值（Token）' : 'Automatic compaction threshold (tokens)', context?.model_context_window ?? 100000000)}
          {number('tool_output_token_limit', zh ? '单次工具输出预算（Token）' : 'Tool output budget (tokens)')}
          {number('model_post_turn_compact_threshold_percent', zh ? '轮次结束压缩阈值（%，0 关闭）' : 'Post-turn compaction threshold (%, 0 disables)', 100)}
          <label>{zh ? '自定义压缩指令（留空使用默认）' : 'Custom compaction instructions (empty uses default)'}<textarea maxLength={32768} value={context!.compact_prompt} onChange={event => c.change({ context: { ...context!, compact_prompt: event.target.value } })} /></label>
          <p>{zh ? '压缩阈值不能超过上下文窗口；留空使用运行时默认值。此处不修改模型的实际服务端容量。' : 'The threshold must not exceed the context window. Empty uses runtime defaults. This does not change the model server’s capacity.'}</p>
        </div>}
      </fieldset>
      {!readOnly && <div className="programming-settings-actions"><button type="submit" className="programming-primary" disabled={c.busy || !c.dirty || c.extraDirty}>{zh ? '保存配置' : 'Save settings'}</button></div>}
    </form> : c.busy ? <p role="status">{zh ? '正在读取…' : 'Loading…'}</p> : null}
    {c.error != null && <p className="programming-error" role="alert">{isDesktopFailure(c.error) && c.error.code === 'conflict' ? (zh ? '配置已被其他操作修改，请重新读取后再保存。' : 'Settings changed elsewhere. Reload before saving.') : describeError(c.error, language)}</p>}
    {c.saved && <p className="programming-saved" role="status">{zh ? '配置已保存，下一轮任务使用新配置。' : 'Saved. The next turn will use these settings.'}</p>}
    <button type="button" disabled={c.busy || c.extraDirty} onClick={() => { if (!c.dirty || window.confirm(zh ? '丢弃未保存修改并重新读取？' : 'Discard unsaved changes and reload?')) void c.load() }}>{zh ? '重新读取' : 'Reload'}</button>
    <button type="button" disabled={c.busy || c.dirty || c.extraDirty} onClick={onOpenConfig}>{zh ? '编辑 config.toml' : 'Edit config.toml'}</button>
  </section>
}
