import type { TimelineItem, ToolStep } from '../timeline'

type Language = 'zh-CN' | 'en-US'

const toolNames: Record<string, [string, string]> = {
  terminal: ['运行终端命令', 'Run terminal command'],
  execute_code: ['执行代码', 'Execute code'],
  read_file: ['读取文件', 'Read file'],
  search_files: ['搜索文件', 'Search files'],
  memory: ['更新记忆', 'Update memory'],
  skill_view: ['查看 Skill', 'View Skill'],
}

function label(language: Language, zh: string, en: string) { return language === 'zh-CN' ? zh : en }
function toolName(name: string, language: Language) { return toolNames[name]?.[language === 'zh-CN' ? 0 : 1] || name }
function toolState(step: ToolStep, language: Language) {
  if (step.state === 'running') return label(language, '执行中', 'Running')
  if (step.state === 'failed') return label(language, '失败', 'Failed')
  if (step.state === 'recorded') return label(language, '有结果', 'Result recorded')
  return label(language, '已结束', 'Finished')
}

function detailText(step: ToolStep) {
  const args = step.args ? JSON.stringify(step.args, null, 2) : ''
  return args || step.context || ''
}

function ToolGroup({ steps, language }: { steps: ToolStep[]; language: Language }) {
  const running = steps.some(step => step.state === 'running')
  const failed = steps.some(step => step.state === 'failed')
  return <details className="tool-group">
    <summary>
      <span>{label(language, '工作过程', 'Work process')} · {steps.length} {label(language, '次工具调用', 'tool calls')}</span>
      <small>{running ? label(language, '进行中', 'Running') : failed ? label(language, '含失败项', 'Contains failures') : label(language, '有结果', 'Results recorded')}</small>
    </summary>
    <div className="tool-steps">{steps.map((step, index) => {
      const details = detailText(step)
      return <details className="tool-step" key={`${step.id}-${index}`}>
        <summary><span>{toolName(step.name, language)}</span><small>{toolState(step, language)}{step.duration != null ? ` · ${step.duration.toFixed(1)}s` : ''}</small></summary>
        {step.context && <div className="tool-step-context">{step.context}</div>}
        {step.summary && <div className="tool-step-summary">{step.summary}</div>}
        {step.error && <div className="tool-step-error">{step.error}</div>}
        {details && <pre>{details.length > 4000 ? `${details.slice(0, 4000)}…` : details}</pre>}
      </details>
    })}</div>
  </details>
}

export default function MessageList({ messages, assistant, language, t }: { messages: TimelineItem[]; assistant: string; language: Language; t: (key: string) => string }) {
  if (!messages.length && !assistant) return <div className="welcome"><span className="hero-mark">H</span><h2>{t('ui.hello.what.do.you.want.to.do.today')}</h2><p>{t('ui.describe.a.task.to.hermess.or.add.files.to.work.on.together')}</p></div>
  return <div className="messages">{messages.map((message, index) => message.kind === 'tools'
    ? <ToolGroup key={index} steps={message.steps} language={language} />
    : message.text.trim() && <p key={index}><strong>{message.role === 'user' ? t('ui.you') : 'Hermes'}：</strong>{message.text}</p>
  )}{assistant.trim() && <p><strong>Hermes：</strong>{assistant}</p>}</div>
}
