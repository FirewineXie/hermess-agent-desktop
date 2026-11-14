import React from 'react'
import type { BotGroup, ModelOptions, ProfileRow, ProfileToolset } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import type { LocalSkill } from '../extensions/model'
import type { Editor } from './scheduledTaskModel'
import ScheduledScheduleBuilder from './ScheduledScheduleBuilder'

type DeliveryTarget = { id: string; name: string; home_target_set: boolean }
type Resources = { models: ModelOptions | null; skills: LocalSkill[]; toolsets: ProfileToolset[]; targets: DeliveryTarget[] }
const empty: Resources = { models: null, skills: [], toolsets: [], targets: [{ id: 'local', name: 'Local', home_target_set: true }] }

function toggle(items: string[], value: string): string[] {
  return items.includes(value) ? items.filter(item => item !== value) : [...items, value]
}

export default function ScheduledTaskEditor({ editor, onChange, onClose, onSubmit, available, failedProfiles, busy, loading }: {
  editor: Editor; onChange: (editor: Editor) => void; onClose: () => void
  onSubmit: (event: React.FormEvent) => void; available: ProfileRow[]; failedProfiles: string[]
  busy: boolean; loading: boolean
}) {
  const { bots, extensions, models, profiles } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [resources, setResources] = React.useState<Resources>(empty)
  const [resourceError, setResourceError] = React.useState('')
  React.useEffect(() => {
    let active = true
    const scope = { kind: 'profile' as const, profile: editor.profile }
    setResources(empty); setResourceError('')
    void Promise.allSettled([
      models.options(scope, { refresh: false }),
      extensions.request<LocalSkill[]>(scope, 'skills.list'),
      profiles.listToolsets(scope),
      extensions.request<{ targets: DeliveryTarget[] }>(scope, 'jobs.delivery.targets'),
      bots.groups<{ rooms: BotGroup[] }>('default', 'list', {}),
    ]).then(results => {
      if (!active) return
      setResources({
        models: results[0].status === 'fulfilled' ? results[0].value : null,
        skills: results[1].status === 'fulfilled' ? results[1].value.filter(item => item.enabled) : [],
        toolsets: results[2].status === 'fulfilled' ? results[2].value : [],
        targets: [
          ...(results[3].status === 'fulfilled' ? results[3].value.targets : empty.targets),
          ...(results[4].status === 'fulfilled' ? results[4].value.rooms.filter(room => room.disbanded_at == null).map(room => ({
            id: `room:${room.room_id}@default`, name: zh ? `群聊 · ${room.name}` : `Group chat · ${room.name}`, home_target_set: true,
          })) : []),
        ],
      })
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') setResourceError(describeError(failure.reason, language))
    })
    return () => { active = false }
  }, [editor.profile, bots, extensions, models, profiles, language, zh])
  const change = <K extends keyof Editor,>(key: K, value: Editor[K]) => onChange({ ...editor, [key]: value })
  const providers = (resources.models?.providers || []).filter(item => item.authenticated !== false)
  const provider = providers.find(item => item.slug === editor.provider)
  const modelNames = provider?.models || []
  const savedProvider = editor.provider && !providers.some(item => item.slug === editor.provider)
  const savedModel = editor.model && !modelNames.includes(editor.model)
  const targets = resources.targets.some(target => target.id === editor.deliver) ? resources.targets
    : [...resources.targets, { id: editor.deliver, name: editor.deliver, home_target_set: true }]
  const hasContent = Boolean(editor.prompt.trim() || editor.script.trim() || editor.skills.length)
  const canSave = !busy && !loading && !failedProfiles.includes(editor.profile) && Boolean(editor.schedule.trim())
    && hasContent && (!editor.no_agent || Boolean(editor.script.trim()))

  return <div className="scheduled-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form className="scheduled-modal scheduled-modal-wide" role="dialog" aria-modal="true" aria-labelledby="scheduled-modal-title" onSubmit={onSubmit}>
      <div className="row"><h3 id="scheduled-modal-title">{editor.mode === 'create' ? (zh ? '新建定时任务' : 'New scheduled task') : (zh ? '编辑定时任务' : 'Edit scheduled task')}</h3>
        <button type="button" disabled={busy} onClick={onClose} aria-label={zh ? '关闭' : 'Close'}>×</button></div>
      <div className="scheduled-modal-body">
        <label>{zh ? '所属 Profile' : 'Profile'}<select value={editor.profile} disabled={editor.mode === 'edit'} onChange={event => change('profile', event.target.value)}>{available.map(item =>
          <option key={item.name} value={item.name} disabled={failedProfiles.includes(item.name)}>{item.display_name || item.name}</option>)}</select></label>
        <label>{zh ? '名称（可选）' : 'Name (optional)'}<input maxLength={100} value={editor.name} onChange={event => change('name', event.target.value)} /></label>
        <ScheduledScheduleBuilder schedule={editor.schedule} onChange={value => change('schedule', value)} zh={zh} />
        <label>{zh ? '任务提示词' : 'Task prompt'}<textarea maxLength={20000} rows={5} value={editor.prompt} onChange={event => change('prompt', event.target.value)} /></label>
        <div className="scheduled-field-pair"><label>{zh ? '投递目标' : 'Delivery target'}<select value={editor.deliver} onChange={event => change('deliver', event.target.value)}>{targets.map(target =>
          <option key={target.id} value={target.id} disabled={!target.home_target_set}>{target.name}{!target.home_target_set ? (zh ? '（未设置主页渠道）' : ' (home channel missing)') : ''}</option>)}</select></label>
          {editor.mode === 'create' && <label>{zh ? '重复次数' : 'Repeat'}<input value={editor.repeat} maxLength={20} placeholder={zh ? '留空表示无限次；once 或数字' : 'Blank = forever; once or number'} onChange={event => change('repeat', event.target.value)} /></label>}</div>
        {editor.mode === 'create' && <label className="scheduled-checkbox"><input type="checkbox" checked={editor.paused} onChange={event => change('paused', event.target.checked)} />{zh ? '创建后先暂停' : 'Create paused'}</label>}
        <details className="scheduled-advanced" open><summary>{zh ? '高级配置' : 'Advanced settings'}</summary>
          <div className="scheduled-field-pair">
            <label>{zh ? '任务时区（IANA）' : 'Task time zone (IANA)'}
              <input value={editor.timezone} maxLength={128} placeholder="Asia/Shanghai" onChange={event => change('timezone', event.target.value)} />
              <small>{zh ? '留空时使用 Profile 的时区。' : 'Leave blank to use the Profile time zone.'}</small>
            </label>
            <label>{zh ? '错过调度的宽限时间（分钟）' : 'Missed run grace period (minutes)'}
              <input type="number" value={editor.grace_minutes} min={0} step={1} onChange={event => change('grace_minutes', event.target.value)} />
              <small>{zh ? '适用于 Cron 表达式。留空使用默认窗口，0 关闭宽限窗口。' : 'Applies to cron expressions. Blank uses the default window. Zero disables the grace window.'}</small>
            </label>
          </div>
          <label>{zh ? '错过调度时' : 'When a run is missed'}
            <select value={String(editor.catch_up)} onChange={event => change('catch_up', event.target.value === 'null' ? null : event.target.value === 'true')}>
              <option value="null">{zh ? '使用默认策略' : 'Use default policy'}</option>
              <option value="true">{zh ? '补跑一次' : 'Catch up once'}</option>
              <option value="false">{zh ? '跳过' : 'Skip'}</option>
            </select>
          </label>
          <p>{zh ? '默认继承所属 Profile 的模型；全局模型与凭据在“设置”中管理。' : 'The job inherits its Profile model by default. Manage models and credentials in Settings.'}</p>
          <div className="scheduled-field-pair"><label>{zh ? '模型提供商覆盖' : 'Provider override'}<select value={editor.provider} onChange={event => onChange({ ...editor, provider: event.target.value, model: '' })}>
            <option value="">{zh ? '继承 Profile' : 'Profile default'}</option>{savedProvider && <option value={editor.provider}>{editor.provider}</option>}{providers.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
            <label>{zh ? '模型覆盖' : 'Model override'}<select value={editor.model} onChange={event => change('model', event.target.value)}><option value="">{zh ? '继承 Profile' : 'Profile default'}</option>{savedModel && <option value={editor.model}>{editor.model}</option>}{modelNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label></div>
          <div className="scheduled-field-pair"><label>{zh ? 'Base URL 覆盖' : 'Base URL override'}<input value={editor.base_url} maxLength={2048} placeholder="https://api.example.com/v1" onChange={event => change('base_url', event.target.value)} /></label>
            <label>{zh ? '工作目录' : 'Work directory'}<input value={editor.workdir} maxLength={4096} onChange={event => change('workdir', event.target.value)} /></label></div>
          <div className="scheduled-field-pair"><label>{zh ? '脚本路径' : 'Script path'}<input value={editor.script} maxLength={4096} onChange={event => change('script', event.target.value)} /></label>
            <label className="scheduled-checkbox"><input type="checkbox" checked={editor.no_agent} onChange={event => change('no_agent', event.target.checked)} />{zh ? '仅运行脚本，不调用 Agent' : 'Run script without agent'}</label></div>
          <label className="scheduled-checkbox"><input type="checkbox" checked={editor.continuity} onChange={event => change('continuity', event.target.checked)} />{zh ? '下一次运行读取本任务上一次输出' : 'Include this job’s previous output'}</label>
          <label>{zh ? '其他任务 ID（每行一个）' : 'Other job IDs (one per line)'}<textarea rows={3} value={editor.context_from} onChange={event => change('context_from', event.target.value)} /></label>
          <div className="scheduled-field-pair"><fieldset><legend>{zh ? '预加载技能' : 'Skills to load'}</legend><div className="scheduled-choice-list">{[...new Set([...editor.skills, ...resources.skills.map(item => item.name)])].map(name => <label key={name}><input type="checkbox" checked={editor.skills.includes(name)} onChange={() => change('skills', toggle(editor.skills, name))} />{name}</label>)}</div></fieldset>
            <fieldset><legend>{zh ? '启用工具集' : 'Enabled toolsets'}</legend><div className="scheduled-choice-list">{[...new Set([...editor.enabled_toolsets, ...resources.toolsets.map(item => item.name)])].map(name => <label key={name}><input type="checkbox" checked={editor.enabled_toolsets.includes(name)} onChange={() => change('enabled_toolsets', toggle(editor.enabled_toolsets, name))} />{name}</label>)}</div></fieldset></div>
        </details>
        {resourceError && <p role="alert" className="scheduled-error">{zh ? '部分选项读取失败：' : 'Some options could not load: '}{resourceError}</p>}
        {!hasContent && <p role="alert" className="scheduled-error">{zh ? '填写提示词、选择技能或指定脚本。' : 'Provide a prompt, a skill, or a script.'}</p>}
        {editor.no_agent && !editor.script.trim() && <p role="alert" className="scheduled-error">{zh ? '仅运行脚本时必须指定脚本路径。' : 'Script-only jobs require a script path.'}</p>}
      </div>
      <div className="scheduled-modal-actions"><button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button>
        <button type="submit" disabled={!canSave}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button></div>
    </form>
  </div>
}
