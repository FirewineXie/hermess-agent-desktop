import React from 'react'
import type { TimelineItem, ToolStep } from '../timeline'
import { assistantCopyLabel, copyAssistantText, type AssistantCopyState } from '../assistantCopy'
import MarkdownMessage from './MarkdownMessage'
import SentAttachmentList from './SentAttachmentList'
import MediaAttachment from './MediaAttachment'
import type { HistorySelection } from './HistoryActionDialog'

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
  const hasDetail = Boolean(detail || step.summary || step.error || step.imagePath || step.riskFindings)
  const progress = step.state === 'running' ? step.progress : undefined
  const progressText = progress?.percent != null ? `${progress.percent}%`
    : progress?.value != null ? [progress.value, progress.total].filter(value => value != null).join('/') : ''
  const heading = <>
          <span className="tool-step-icon" aria-hidden="true">{step.name === 'terminal' || step.name === 'execute_code' ? '›' : step.name === 'read_file' || step.name === 'search_files' ? '▤' : '◇'}</span>
          <span className="tool-step-name">{toolName(step.name, language)}</span>
          <small>{toolState(step, language)}{progressText && ` · ${progressText}`}{step.duration != null ? ` · ${step.duration.toFixed(1)}s` : ''}</small>
          {step.riskFindings && <strong>{language === 'zh-CN' ? '工具输出存在风险' : 'Risk detected in tool output'}</strong>}
          {hasDetail && <span className="tool-step-chevron" aria-hidden="true">⌄</span>}
  </>
  if (!hasDetail) return <div className="tool-step"><div className="tool-step-heading">{heading}</div>
    {progress?.message && <div className="tool-step-summary">{progress.message}</div>}</div>
  return <details className="tool-step" open={step.imagePath ? true : undefined}>
    <summary>{heading}</summary>
    {progress?.message && <div className="tool-step-summary">{progress.message}</div>}
    {!!step.riskFindings?.length && <div className="tool-step-summary">{step.riskFindings.join(' · ')}</div>}
    {step.summary && <div className="tool-step-summary">{step.summary}</div>}
    {step.error && <div className="tool-step-error">{step.error}</div>}
    {step.imagePath && <MediaAttachment source={step.imagePath} language={language} />}
    {detail && <div className="tool-step-detail"><div>{detail.title}</div><pre>{detail.text.length > 4000 ? `${detail.text.slice(0, 4000)}…` : detail.text}</pre></div>}
  </details>
}

function ToolActivity({ steps, language }: { steps: ToolStep[]; language: Language }) {
  return <div className="tool-activity">{steps.map((step, index) => <ToolRow key={`${step.id}-${index}`} step={step} language={language} />)}</div>
}

function AssistantMessage({ text, language, streaming = false, media, showCopy = false, actions }: { text: string; language: Language; streaming?: boolean; media?: string[]; showCopy?: boolean; actions?: React.ReactNode }) {
  const [copyState, setCopyState] = React.useState<AssistantCopyState>('idle')
  const resetTimer = React.useRef<number | null>(null)
  React.useEffect(() => () => {
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current)
  }, [])
  const copy = async () => {
    const state = await copyAssistantText(text, value => navigator.clipboard.writeText(value))
    setCopyState(state)
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 1500)
  }
  return <div className="message message-assistant">
    <MarkdownMessage text={text} language={language} streaming={streaming} />
    <HistoryMedia sources={media} language={language} />
    {((showCopy && !streaming && text.trim()) || actions) && <div className="assistant-message-actions">
      {showCopy && !streaming && text.trim() && <button type="button" onClick={() => void copy()}>{assistantCopyLabel(language, copyState)}</button>}{actions}
    </div>}
  </div>
}

function HistoryMedia({ sources, language }: { sources?: string[]; language: Language }) {
  return sources?.map((source, index) => <MediaAttachment key={index} source={source} language={language} />)
}

function ReasoningBlock({ text, streaming, expanded, language }: { text: string; streaming: boolean; expanded: boolean; language: Language }) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (expanded && streaming && contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [text, streaming, expanded])
  return <details className="reasoning-block" open={expanded}>
    <summary className="reasoning-heading"><span>{streaming ? label(language, '正在思考…', 'Thinking…') : label(language, '思考过程', 'Reasoning')}</span><span className="tool-activity-chevron" aria-hidden="true">⌄</span></summary>
    <div ref={contentRef} className="reasoning-content"><MarkdownMessage text={text} language={language} streaming={streaming} /></div>
  </details>
}

export default function MessageList({ messages, assistant, turnBusy, language, t, onHistoryAction, editBlocked }: { messages: TimelineItem[]; assistant: string; turnBusy: boolean; language: Language; t: (key: string) => string; onHistoryAction?: (selection: HistorySelection) => void; editBlocked?: boolean }) {
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
  const historyActions = ({ role, text, rowId }: Extract<TimelineItem, { kind: 'message' }>) => {
    if (!rowId || !onHistoryAction || turnBusy) return null
    return <>
      {role === 'user' && text.trim() && <button type="button" disabled={editBlocked}
        title={editBlocked ? label(language, '请先处理输入框中的草稿或附件', 'Finish the current draft or attachments first') : undefined}
        onClick={() => onHistoryAction({ operation: 'rewind', rowId, text, role })}>{label(language, '编辑重发', 'Edit and resend')}</button>}
      <button type="button" onClick={() => onHistoryAction({ operation: 'branch', rowId, text, role })}>{label(language, '从这里分叉', 'Branch from here')}</button>
    </>
  }
  const blocks: React.ReactNode[] = []
  for (let index = 0; index < messages.length;) {
    const message = messages[index]
    if (message.kind === 'message' && message.role === 'user') {
      let end = index + 1
      while (end < messages.length) {
        const next = messages[end]
        if (next.kind === 'message' && next.role === 'user') break
        end++
      }
      const following = messages.slice(index + 1, end)
      let finalIndex = -1
      if (end < messages.length || !turnBusy || message.turnState != null) {
        for (let position = following.length - 1; position >= 0; position--) {
          const item = following[position]
          if (item.kind === 'message' && item.role === 'assistant') { finalIndex = position; break }
        }
      }
      const hasTime = message.duration != null || index === activeUserIndex
      const userText = message.attachments?.length && message.text === t('ui.please.see.attachment')
        ? label(language, `已发送 ${message.attachments.length} 个附件`, `Sent ${message.attachments.length} attachments`)
        : message.text
      blocks.push(<React.Fragment key={`turn-${index}`}>
        <div className="message message-user"><p>{userText}</p>{message.attachments?.length ? <SentAttachmentList attachments={message.attachments} language={language} /> : null}<HistoryMedia sources={message.media} language={language} /></div>
        {message.rowId && onHistoryAction && !turnBusy && <div className="assistant-message-actions user-history-actions">{historyActions(message)}</div>}
        {hasTime && <div className="turn-duration" title={message.estimated ? label(language, '根据消息记录时间估算', 'Estimated from message timestamps') : undefined}>{turnTimeText(message, now, language)}</div>}
        {following.map((item, position) => item.kind === 'tools'
          ? <ToolActivity key={position} steps={item.steps} language={language} />
          : item.kind === 'reasoning'
            ? <ReasoningBlock key={position} text={item.text} streaming={item.streaming} expanded={item.expanded} language={language} />
            : <AssistantMessage key={position} text={item.text} media={item.media} language={language} showCopy={position === finalIndex && message.turnState !== 'failed' && message.turnState !== 'interrupted'} actions={historyActions(item)} />)}
      </React.Fragment>)
      index = end
    } else {
      blocks.push(message.kind === 'tools'
        ? <ToolActivity key={`orphan-${index}`} steps={message.steps} language={language} />
        : message.kind === 'reasoning'
          ? <ReasoningBlock key={`orphan-${index}`} text={message.text} streaming={message.streaming} expanded={message.expanded} language={language} />
          : <AssistantMessage key={`orphan-${index}`} text={message.text} media={message.media} language={language} actions={historyActions(message)} />)
      index++
    }
  }
  return <div className="messages">{blocks}{assistant.trim() && <AssistantMessage text={assistant} language={language} streaming={turnBusy} />}</div>
}
