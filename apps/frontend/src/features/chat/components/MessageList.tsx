import React from 'react'
import type { TimelineItem, ToolStep } from '../timeline'

type Language = 'zh-CN' | 'en-US'

const toolNames: Record<string, [string, string]> = {
  terminal: ['调用了终端', 'Called terminal'],
  execute_code: ['调用了代码执行', 'Called code execution'],
  read_file: ['调用了文件读取', 'Called file reader'],
  search_files: ['调用了文件搜索', 'Called file search'],
  memory: ['调用了记忆工具', 'Called memory tool'],
  skill_view: ['查看了 Skill', 'Viewed Skill'],
}

function label(language: Language, zh: string, en: string) { return language === 'zh-CN' ? zh : en }
function toolName(name: string, language: Language) { return toolNames[name]?.[language === 'zh-CN' ? 0 : 1] || name }
function activityTitle(steps: ToolStep[], language: Language) {
  const failures = steps.filter(step => step.state === 'failed').length
  const running = steps.some(step => step.state === 'running')
  const parts = language === 'zh-CN'
    ? ['执行过程', `${steps.length} 项操作`]
    : ['Activity', `${steps.length} ${steps.length === 1 ? 'action' : 'actions'}`]
  if (running) parts.push(label(language, '正在执行', 'Running'))
  if (failures) parts.push(language === 'zh-CN' ? `${failures} 项失败` : `${failures} failed`)
  return parts.join(' · ')
}
function formatDuration(value: number, language: Language) {
  const seconds = Math.max(0, Math.round(value))
  if (seconds < 60) return language === 'zh-CN' ? `${seconds} 秒` : `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return language === 'zh-CN' ? `${minutes} 分 ${remainder} 秒` : `${minutes}m ${remainder}s`
}
function turnTimeText(message: Extract<TimelineItem, { kind: 'message' }>, now: number, language: Language) {
  const elapsed = formatDuration(message.duration ?? Math.max(0, (now - (message.startedAt || now)) / 1000), language)
  if (message.turnState === 'failed') return language === 'zh-CN' ? `执行失败 · 用时 ${elapsed}` : `Failed · ${elapsed}`
  if (message.turnState === 'interrupted') return language === 'zh-CN' ? `已停止 · 用时 ${elapsed}` : `Stopped · ${elapsed}`
  if (message.turnState == null) return language === 'zh-CN' ? `正在执行 · 已用时 ${elapsed}` : `Running · ${elapsed}`
  return language === 'zh-CN' ? `${message.estimated ? '约' : ''}用时 ${elapsed}` : `${message.estimated ? 'About ' : ''}${elapsed}`
}
function toolState(step: ToolStep, language: Language) {
  if (step.state === 'running') return label(language, '执行中', 'Running')
  if (step.state === 'failed') return label(language, '失败', 'Failed')
  if (step.state === 'recorded') return label(language, '有结果', 'Result recorded')
  return label(language, '已结束', 'Finished')
}

function toolDetail(step: ToolStep, language: Language): { title: string; text: string } | null {
  const args = step.args || {}
  if (step.name === 'terminal' && typeof args.command === 'string') return { title: 'Shell', text: `$ ${args.command}` }
  if (step.name === 'execute_code' && typeof args.code === 'string') return { title: 'Code', text: args.code }
  const raw = Object.keys(args).length ? JSON.stringify(args, null, 2) : step.context || ''
  return raw ? { title: label(language, '参数', 'Parameters'), text: raw } : null
}

function ToolRow({ step, language }: { step: ToolStep; language: Language }) {
  const detail = toolDetail(step, language)
  const hasDetail = Boolean(detail || step.summary || step.error)
  const heading = <>
          <span className="tool-step-icon" aria-hidden="true">{step.name === 'terminal' || step.name === 'execute_code' ? '›' : step.name === 'read_file' || step.name === 'search_files' ? '▤' : '◇'}</span>
          <span className="tool-step-name">{toolName(step.name, language)}</span>
          <small>{toolState(step, language)}{step.duration != null ? ` · ${step.duration.toFixed(1)}s` : ''}</small>
          {hasDetail && <span className="tool-step-chevron" aria-hidden="true">⌄</span>}
  </>
  if (!hasDetail) return <div className="tool-step"><div className="tool-step-heading">{heading}</div></div>
  return <details className="tool-step">
    <summary>{heading}</summary>
    {step.summary && <div className="tool-step-summary">{step.summary}</div>}
    {step.error && <div className="tool-step-error">{step.error}</div>}
    {detail && <div className="tool-step-detail"><div>{detail.title}</div><pre>{detail.text.length > 4000 ? `${detail.text.slice(0, 4000)}…` : detail.text}</pre></div>}
  </details>
}

function ToolActivity({ steps, language }: { steps: ToolStep[]; language: Language }) {
  return <details className={`tool-activity${steps.some(step => step.state === 'failed') ? ' has-failure' : ''}`}>
    <summary><span className="tool-activity-icon" aria-hidden="true">▤</span><span>{activityTitle(steps, language)}</span><span className="tool-activity-chevron" aria-hidden="true">⌄</span></summary>
    <div className="tool-steps">{steps.map((step, index) => <ToolRow key={`${step.id}-${index}`} step={step} language={language} />)}</div>
  </details>
}

export default function MessageList({ messages, assistant, turnBusy, language, t }: { messages: TimelineItem[]; assistant: string; turnBusy: boolean; language: Language; t: (key: string) => string }) {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    if (!turnBusy) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [turnBusy])
  let activeUserIndex = -1
  if (turnBusy) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const item = messages[index]
      if (item.kind === 'message' && item.role === 'user' && item.startedAt != null && item.turnState == null) {
        activeUserIndex = index
        break
      }
    }
  }
  if (!messages.length && !assistant) return <div className="welcome"><span className="hero-mark">H</span><h2>{t('ui.hello.what.do.you.want.to.do.today')}</h2><p>{t('ui.describe.a.task.to.hermess.or.add.files.to.work.on.together')}</p></div>
  return <div className="messages">{messages.map((message, index) => message.kind === 'tools'
    ? <ToolActivity key={`${index}-${message.steps[0]?.id || ''}`} steps={message.steps} language={language} />
    : message.text.trim() && <React.Fragment key={index}>
      <p className={`message message-${message.role}`}>{message.role === 'assistant' && <strong>Hermes：</strong>}{message.text}</p>
      {message.role === 'user' && (message.duration != null || index === activeUserIndex) && <div className="turn-duration" title={message.estimated ? label(language, '根据消息记录时间估算', 'Estimated from message timestamps') : undefined}>{turnTimeText(message, now, language)}</div>}
    </React.Fragment>
  )}{assistant.trim() && <p className="message message-assistant"><strong>Hermes：</strong>{assistant}</p>}</div>
}
