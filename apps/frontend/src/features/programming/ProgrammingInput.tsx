import React from 'react'
import type { CodingSkillCatalog } from '@hermess/contracts'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import { clipboardImages } from '../chat/clipboardImages'
import ProgrammingInputOption, { type InputOption } from './ProgrammingInputOption'
import { parseProgrammingCommand } from './programmingCommands'

const commands = [
  ['new', '新建聊天', 'New chat', '在当前项目开始新的聊天', 'Start a new chat in this project'],
  ['skills', 'Skills', 'Skills', '选择当前项目的可用技能', 'Choose an available project skill'],
  ['goal', '目标', 'Goal', '设置、查看、暂停或恢复持续执行的目标', 'Set, inspect, pause or resume a persistent goal'],
  ['plan', '计划模式', 'Plan mode', '先讨论实现方案，再决定执行', 'Discuss the implementation before executing'],
  ['compact', '压缩上下文', 'Compact context', '由 Codex 原生压缩当前会话', 'Run native conversation compaction'],
  ['review', '代码审查', 'Code review', '由 Codex 原生审查改动、分支或提交', 'Run a native review of changes, a branch or a commit'],
  ['status', '运行状态', 'Run status', '查看模型、工作目录和权限', 'Show model, working directory and permissions'],
  ['settings', '编程设置', 'Programming settings', '管理模型连接与编程运行时', 'Manage model connections and runtime'],
  ['help', '帮助', 'Help', '查看可用命令，使用 ↑ ↓ 选择', 'Browse commands; use ↑ ↓ to select'],
] as const

export default function ProgrammingInput({ language, controller, onOpenSettings, ref }: {
  language: Language; controller: ProgrammingController; onOpenSettings?: () => void; ref?: React.Ref<{ submit(): void }>
}) {
  const zh = language === 'zh-CN'
  const { coding, session, cwd, draft, setDraft, busy, images, files, send } = controller
  const input = React.useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = React.useState(draft.length)
  const [dismissed, setDismissed] = React.useState(false)
  const [selected, setSelected] = React.useState(0)
  const [catalog, setCatalog] = React.useState<CodingSkillCatalog | null>(null)
  const [error, setError] = React.useState(false)
  const [retry, reload] = React.useReducer(value => value + 1, 0)
  const [status, setStatus] = React.useState(false)
  const [commandError, setCommandError] = React.useState('')
  const commandName = draft.match(/^\/(goal|plan|review)\s/)?.[1]
  const disabled = busy || session?.status === 'running'
  const token = draft.slice(0, caret).match(/(?:^|\s)(\$[\w-]*$)|^(\/[\w-]*$)/)
  const mode = !disabled && !dismissed && token ? (token[1] ? 'skills' : 'commands') : null
  const query = (token?.[1] || token?.[2] || '').slice(1).toLowerCase()
  const directory = session?.cwd || cwd
  React.useEffect(() => {
    setDismissed(false); setSelected(0); setStatus(false)
  }, [session?.id])
  React.useEffect(() => {
    if (mode !== 'skills') return
    let active = true
    setCatalog(null); setError(false)
    void coding.skills(directory).then(value => { if (active) setCatalog(value) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [coding, directory, mode, retry])
  const rows: InputOption[] = mode === 'skills'
    ? (catalog?.skills || []).filter(skill => skill.enabled && skill.name.toLowerCase().includes(query)).map(skill => ({ id: skill.path, label: `$${skill.name}`, description: skill.description, skill, icon: 'skill' }))
    : commands.filter(([name, cn, en]) => `${name} ${cn} ${en}`.toLowerCase().includes(query) && (name !== 'settings' || onOpenSettings))
      .map(([name, cn, en, cnDescription, enDescription]) => ({ id: name, label: zh ? cn : en, description: zh ? cnDescription : enDescription, icon: name, command: `/${name}`, submenu: name === 'skills' }))
  const index = Math.min(selected, Math.max(0, rows.length - 1))
  React.useEffect(() => {
    if (mode) document.getElementById(`programming-input-option-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [index, mode])
  const replace = (value: string) => {
    const start = caret - (token?.[1] || token?.[2] || '').length
    const next = draft.slice(0, start) + value + draft.slice(caret)
    setDraft(next); setCaret(start + value.length); setSelected(0)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + value.length, start + value.length) })
  }
  const choose = (row: typeof rows[number]) => {
    if (row.skill) { replace(`${row.label} `); return }
    switch (row.id) {
      case 'skills': replace('$'); return
      case 'help': replace('/'); return
      case 'new': controller.newSession(directory, session?.project_id || controller.draftProjectId); break
      case 'settings': setDraft(''); onOpenSettings?.(); break
      case 'status': setDraft(''); setStatus(true); break
      case 'compact': void controller.executeCommand({ type: 'compact' }).then(success => { if (success) setDraft('') }); break
      case 'goal': case 'plan': case 'review': replace(`/${row.id} `); return
    }
    setDismissed(true); input.current?.focus()
  }
  const submit = () => {
    if (disabled) return
    if (draft.startsWith('/')) {
      const parsed = parseProgrammingCommand(draft)
      if (parsed.error) { setCommandError(zh ? parsed.error : 'Invalid command arguments. Check the command examples below.'); return }
      if (parsed.command) {
        setCommandError(''); setDismissed(true)
        const submitted = draft
        void controller.executeCommand(parsed.command).then(success => { if (success) setDraft(current => current === submitted ? '' : current) })
        return
      }
      const command = commands.find(([name]) => draft.trim() === `/${name}` && (name !== 'settings' || onOpenSettings))
      if (command) choose({ id: command[0], label: `/${command[0]}`, description: '', skill: undefined })
      else { setDismissed(false); input.current?.focus() }
      return
    }
    if (draft.trim() || images.length || files.length) void send()
  }
  React.useImperativeHandle(ref, () => ({ submit }))
  return <div className="programming-input">
    {commandName && !disabled && <div className="programming-command-hints" role="note">
      <p>{commandName === 'goal' ? (zh ? '/goal 目标与验收条件 · 可选 --budget 正整数；不填则不新增预算' : '/goal objective · Optional --budget positive-integer; no implicit budget')
        : commandName === 'plan' ? (zh ? '/plan 任务：先分析与澄清；/plan off：切回执行模式' : '/plan task: analyze and clarify; /plan off: return to execution')
          : (zh ? '/review：审查未提交改动；也可指定分支、提交或审查要求' : '/review: review uncommitted changes, or specify a branch, commit or instructions')}</p>
      <div>{(commandName === 'goal' ? [['查看目标', 'Inspect goal', '/goal '], ['暂停', 'Pause', '/goal pause'], ['恢复', 'Resume', '/goal resume'], ['清除', 'Clear', '/goal clear']]
        : commandName === 'plan' ? [['计划模式', 'Plan mode', '/plan '], ['执行模式', 'Default mode', '/plan off']]
          : [['未提交改动', 'Uncommitted', '/review '], ['比较分支', 'Base branch', '/review --base '], ['指定提交', 'Commit', '/review --commit '], ['自定义要求', 'Custom', '/review --custom ']])
        .map(([label, english, value]) => <button type="button" key={label} onClick={() => { setDraft(value); setCaret(value.length); setCommandError(''); requestAnimationFrame(() => input.current?.focus()) }}>{zh ? label : english}</button>)}</div>
    </div>}
    {commandError && <p className="programming-command-error" role="alert">{commandError}</p>}
    {status && <div className="programming-input-menu" role="status"><button type="button" onClick={() => setStatus(false)}>{zh ? '关闭' : 'Close'}</button>
      <p>{session?.model || controller.catalog?.providers.flatMap(provider => provider.models).find(model => model.id === controller.selectedModelId)?.name}</p>
      <p>{directory}</p><p>{controller.permissions} · {controller.effort}</p>
      <p>{zh ? '状态' : 'Status'}: {session?.status || 'idle'}</p>
    </div>}
    {mode && <div className="programming-input-menu" id="programming-input-menu" role="listbox" aria-label={mode === 'skills' ? 'Skills' : (zh ? '可用命令' : 'Available commands')}>
      {mode === 'skills' && !catalog && !error && <p role="status">{zh ? '正在读取项目 Skills…' : 'Loading project skills…'}</p>}
      {error && <p role="alert">{zh ? 'Skills 读取失败，请检查编程运行时。' : 'Could not load skills. Check the programming runtime.'}<button type="button" onClick={() => reload()}>{zh ? '重试' : 'Retry'}</button></p>}
      {mode === 'skills' && catalog && !rows.length && <p>{zh ? '没有匹配的可用 Skill。项目技能放在 .agents/skills/<名称>/SKILL.md。' : 'No matching enabled skills. Add project skills under .agents/skills/<name>/SKILL.md.'}</p>}
      {catalog && mode === 'skills' && catalog.errors.length > 0 && <p role="alert">{zh ? `${catalog.errors.length} 个 Skill 加载失败` : `${catalog.errors.length} skill loading errors`}</p>}
      {mode === 'commands' && !rows.length && <p>{zh ? '没有匹配的命令' : 'No matching commands'}</p>}
      {rows.map((row, i) => <ProgrammingInputOption key={row.id} row={row} index={i} selected={index === i} onChoose={() => choose(row)} />)}
    </div>}
    <textarea ref={input} value={draft} disabled={disabled} aria-label={zh ? '编程任务' : 'Programming task'}
      onPaste={event => {
        const pasted = clipboardImages(event.clipboardData)
        if (!pasted.length) return
        event.preventDefault()
        if (!disabled) void controller.pasteImages(pasted)
      }}
      aria-controls={mode ? 'programming-input-menu' : undefined} aria-expanded={!!mode}
      aria-activedescendant={mode && rows.length ? `programming-input-option-${index}` : undefined}
      onSelect={event => setCaret(event.currentTarget.selectionStart)}
      onChange={event => { setDraft(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); setSelected(0); setStatus(false); setCommandError('') }}
      placeholder={!session && !cwd ? (zh ? '从左侧添加项目后开始编程…' : 'Add a project from the sidebar to start…') : (zh ? '描述任务，输入 / 使用命令，$ 选择 Skill…' : 'Describe a task, / for commands, $ for skills…')}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (mode && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected(rows.length ? (index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length : 0); return }
        if (mode && event.key === 'Escape') { event.preventDefault(); setDismissed(true); return }
        if (mode && rows.length && (event.key === 'Tab' || event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); choose(rows[index]); return }
        if (mode === 'commands' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); return }
        if (event.key === 'Enter' && !event.shiftKey && !disabled && (session || cwd) && (draft.trim() || images.length || files.length)) { event.preventDefault(); submit() }
      }} />
  </div>
}
