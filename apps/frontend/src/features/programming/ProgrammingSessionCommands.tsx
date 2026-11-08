import React from 'react'
import type { CodingGoal, CodingQuestion } from '@hermess/contracts'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'

function goalLabel(status: CodingGoal['status'], language: Language, connected: boolean) {
  if (status === 'active' && !connected) return language === 'zh-CN' ? '状态待确认' : 'Unconfirmed'
  const labels = { active: '执行中', paused: '已暂停', blocked: '等待处理阻碍', usageLimited: '达到用量限制', budgetLimited: '达到预算', complete: '已完成' }
  return language === 'zh-CN' ? labels[status] : status
}

function GoalEditor({ controller, language, objective, onClose }: {
  controller: ProgrammingController; language: Language; objective: string; onClose(): void
}) {
  const [draft, setDraft] = React.useState(objective)
  const [submitted, setSubmitted] = React.useState<string | null>(null)
  const zh = language === 'zh-CN'
  React.useEffect(() => {
    if (submitted === null) return
    if (objective === submitted) onClose()
    else if (!controller.busy && controller.session?.status !== 'running') setSubmitted(null)
  }, [objective, submitted, controller.busy, controller.session?.status, onClose])
  const save = async () => {
    const value = draft.trim()
    setSubmitted(value)
    if (!await controller.executeCommand({ type: 'goal', action: 'update', objective: value })) setSubmitted(null)
  }
  return <form className="programming-goal-editor" onSubmit={event => { event.preventDefault(); void save() }}>
    <label>{zh ? '编辑当前目标与验收条件' : 'Edit objective and completion criteria'}
      <textarea autoFocus value={draft} disabled={submitted !== null || controller.busy} maxLength={8192} onChange={event => setDraft(event.target.value)} />
    </label>
    <small>{zh ? '保存只更新目标正文，保留当前执行状态和预算。' : 'Saving updates the objective and preserves its status and budget.'}</small>
    {(controller.error || controller.session?.error) && <p role="alert">{controller.error || controller.session?.error}</p>}
    <div><button type="button" disabled={submitted !== null || controller.busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button>
      <button disabled={submitted !== null || controller.busy || !draft.trim() || draft.trim() === objective}>{submitted !== null ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存目标' : 'Save goal')}</button></div>
  </form>
}

export function ProgrammingGoal({ controller, language }: { controller: ProgrammingController; language: Language }) {
  const [editing, setEditing] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const goal = controller.session?.context?.goal
  const hasGoal = !!goal
  React.useEffect(() => { if (!hasGoal) { setEditing(false); setExpanded(false) } }, [hasGoal])
  if (!goal) return null
  const zh = language === 'zh-CN'
  const connected = controller.session?.status === 'running' && controller.session.context?.active_command === 'goal'
  const seconds = Math.floor(goal.timeUsedSeconds)
  const elapsed = `${seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ` : ''}${seconds >= 60 ? `${Math.floor(seconds % 3600 / 60)}m ` : ''}${seconds % 60}s`
  const icon = (paths: React.ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
  return <section className="programming-goal programming-current-goal" aria-label={zh ? '会话目标' : 'Session goal'}>
    <div className="programming-goal-strip">
      {icon(<><circle cx="12" cy="12" r="8" /><path d="m12 12 8-8m-2 0h2v2M12 8a4 4 0 1 0 4 4" /></>)}
      <span className="programming-goal-status" title={goalLabel(goal.status, language, connected)}>{goalLabel(goal.status, language, connected)}{zh ? '的目标' : ' goal'}</span>
      <button className="programming-goal-title" type="button" title={goal.objective} aria-label={`${zh ? '编辑目标' : 'Edit goal'}: ${goal.objective}`} disabled={controller.busy || editing} onClick={() => setEditing(true)}>{goal.objective}</button>
      <small className="programming-goal-time" title={zh ? '原生目标累计运行时间' : 'Native goal accumulated run time'}>· {elapsed}</small>
      {!editing && <div className="programming-goal-actions">
        <button type="button" title={zh ? '编辑目标' : 'Edit goal'} aria-label={zh ? '编辑目标' : 'Edit goal'} disabled={controller.busy} onClick={() => setEditing(true)}>{icon(<path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14Z" />)}</button>
        <button type="button" title={zh ? '清除目标' : 'Clear goal'} aria-label={zh ? '清除目标' : 'Clear goal'} disabled={controller.busy} onClick={() => void controller.executeCommand({ type: 'goal', action: 'clear' })}>{icon(<><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>)}</button>
        {goal.status === 'active' ? <button type="button" title={zh ? '暂停目标' : 'Pause goal'} aria-label={zh ? '暂停目标' : 'Pause goal'} disabled={controller.busy} onClick={() => void controller.executeCommand({ type: 'goal', action: 'pause' })}>{icon(<><circle cx="12" cy="12" r="9" /><path d="M9 8v8m6-8v8" /></>)}</button>
          : goal.status !== 'complete' && <button type="button" title={zh ? '恢复目标' : 'Resume goal'} aria-label={zh ? '恢复目标' : 'Resume goal'} disabled={controller.busy || controller.session?.status === 'running'} onClick={() => void controller.executeCommand({ type: 'goal', action: 'resume' })}>{icon(<><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>)}</button>}
        <button type="button" title={zh ? '展开目标详情' : 'Expand goal details'} aria-label={zh ? '展开目标详情' : 'Expand goal details'} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{icon(<path d={expanded ? 'M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5' : 'M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5'} />)}</button>
      </div>}
    </div>
    {editing && <GoalEditor controller={controller} language={language} objective={goal.objective} onClose={() => setEditing(false)} />}
    {expanded && !editing && <div className="programming-goal-details">
      <p className="programming-goal-objective">{goal.objective}</p>
      <small>{goal.tokensUsed.toLocaleString()} tokens{goal.tokenBudget !== null ? ` / ${goal.tokenBudget.toLocaleString()}` : ''}</small>
      {goal.status === 'active' && !connected && <p>{zh ? '连接已结束，以上为最后记录的目标状态。恢复前请检查项目现状。' : 'Disconnected. This is the last recorded state; check the project before resuming.'}</p>}
      <button type="button" disabled={controller.busy} onClick={() => void controller.executeCommand({ type: 'goal', action: 'get' })}>{zh ? '刷新' : 'Refresh'}</button>
    </div>}
  </section>
}

export function ProgrammingSessionIndicators({ controller, language }: { controller: ProgrammingController; language: Language }) {
  const context = controller.session?.context
  const running = controller.session?.status === 'running'
  const zh = language === 'zh-CN'
  return <div className="programming-session-indicators" aria-label={zh ? '当前会话状态' : 'Current session state'}>
    <span data-active={context?.mode === 'plan'}>{context?.mode === 'plan' ? (zh ? '/plan 已启用' : '/plan enabled') : (zh ? '执行模式' : 'Default mode')}</span>
    {context?.goal && <span title={context.goal.objective} data-active={running && context.active_command === 'goal' && context.goal.status === 'active'}>/goal {goalLabel(context.goal.status, language, running && context.active_command === 'goal')}</span>}
    {running && context?.active_command === 'review' && <span data-active="true">/review {zh ? '审查中' : 'Reviewing'}</span>}
    {running && context?.active_command === 'compact' && <span data-active="true">/compact {zh ? '压缩中' : 'Compacting'}</span>}
  </div>
}

export function ProgrammingQuestion({ question, controller, language }: { question: CodingQuestion; controller: ProgrammingController; language: Language }) {
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [submitted, setSubmitted] = React.useState(false)
  const zh = language === 'zh-CN'
  return <form className="programming-goal" aria-label={zh ? 'Codex 澄清问题' : 'Codex questions'} onSubmit={event => {
    event.preventDefault()
    void controller.answerQuestion(question.id, Object.fromEntries(question.questions.map(row => [row.id, { answers: [values[row.id]] }]))).then(success => { if (success) setSubmitted(true) })
  }}>
    {question.questions.map(row => <fieldset key={row.id} disabled={submitted || controller.busy}><legend>{row.header}</legend><p>{row.question}</p>
      {row.options?.map(option => <label key={option.label}><input type="radio" name={row.id} checked={values[row.id] === option.label} onChange={() => setValues(current => ({ ...current, [row.id]: option.label }))} />{option.label}<small>{option.description}</small></label>)}
      {(!row.options?.length || row.isOther) && <label>{zh ? '你的回答' : 'Your answer'}<input type={row.isSecret ? 'password' : 'text'} value={values[row.id] || ''} onChange={event => setValues(current => ({ ...current, [row.id]: event.target.value }))} /></label>}
    </fieldset>)}
    <button disabled={submitted || controller.busy || question.questions.some(row => !values[row.id]?.trim())}>{submitted ? (zh ? '已提交回答' : 'Answers submitted') : (zh ? '提交回答' : 'Submit answers')}</button>
  </form>
}
