import React from 'react'
import ReactDOM from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import './style.css'

type RuntimeProbe = {
  tool: string
  path: string | null
  version: string | null
  usable: boolean
  reason: string
}
type BackendInfo = { port: number; pid: number }
type DevDefaults = { python_path: string; storage_path: string }
type GatewayEvent = { kind: string; session_id?: string; payload: Record<string, unknown> }
type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
type GatewayRequest = {
  id: string
  method: 'approval' | 'clarify'
  params: {
    session_id?: string
    command?: string
    description?: string
    tool_name?: string
    choices?: ApprovalChoice[]
    questions?: Array<{ qid: string; question: string; choices?: string[] }>
  }
}

function App() {
  const [probes, setProbes] = React.useState<RuntimeProbe[]>([])
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [pythonPath, setPythonPath] = React.useState('')
  const [storagePath, setStoragePath] = React.useState('')
  const [backend, setBackend] = React.useState<BackendInfo | null>(null)
  const [backendStatus, setBackendStatus] = React.useState('未启动')
  const [busy, setBusy] = React.useState(false)
  const [sessionId, setSessionId] = React.useState('')
  const sessionRef = React.useRef('')
  const [draft, setDraft] = React.useState('')
  const [conversation, setConversation] = React.useState<Array<{ role: string; text: string }>>([])
  const [assistant, setAssistant] = React.useState('')
  const assistantRef = React.useRef('')
  const [chatStatus, setChatStatus] = React.useState('')
  const [turnBusy, setTurnBusy] = React.useState(false)
  const [serverRequests, setServerRequests] = React.useState<GatewayRequest[]>([])
  const serverRequest = serverRequests[0] || null
  const [clarifyAnswers, setClarifyAnswers] = React.useState<Record<string, string>>({})

  async function inspect() {
    setLoading(true)
    setError('')
    try {
      setProbes(await invoke<RuntimeProbe[]>('probe_local_tools'))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void inspect()
    if (import.meta.env.DEV) {
      void invoke<DevDefaults>('dev_backend_defaults').then(defaults => {
        setPythonPath(defaults.python_path)
        setStoragePath(defaults.storage_path)
      }).catch(cause => setBackendStatus(String(cause)))
    }
  }, [])

  React.useEffect(() => {
    let active = true
    let unlistenEvent: (() => void) | undefined
    let unlistenDisconnect: (() => void) | undefined
    let unlistenRequest: (() => void) | undefined
    void listen<GatewayEvent>('hermes-event', event => {
      const data = event.payload
      if (!active || data.session_id !== sessionRef.current) return
      if (data.kind === 'message.delta' && typeof data.payload?.text === 'string') {
        assistantRef.current += data.payload.text
        setAssistant(assistantRef.current)
      } else if (data.kind === 'message.complete') {
        const text = typeof data.payload?.text === 'string' ? data.payload.text : ''
        setConversation(rows => [...rows, { role: 'assistant', text: text || assistantRef.current }])
        assistantRef.current = ''
        setAssistant('')
        setTurnBusy(false)
        setChatStatus(data.payload?.status === 'error' ? String(data.payload?.error || '回复失败') : '回复完成')
      } else if (data.kind === 'error') {
        setChatStatus(String(data.payload?.message || '后端错误'))
        setTurnBusy(false)
      } else if (data.kind === 'tool.start' || data.kind === 'tool.complete') {
        setChatStatus(`${data.kind === 'tool.start' ? '正在调用' : '已完成工具'}：${String(data.payload?.name || '工具')}`)
      } else if (data.kind === 'request.cancel') {
        setServerRequests(current => current.filter(request => request.id !== data.payload?.id))
      }
    }).then(fn => { if (active) unlistenEvent = fn; else fn() })
    void listen<GatewayRequest>('hermes-request', event => {
      if (active && event.payload.params.session_id === sessionRef.current) {
        setServerRequests(current => current.some(request => request.id === event.payload.id) ? current : [...current, event.payload])
      }
    }).then(fn => { if (active) unlistenRequest = fn; else fn() })
    void listen('hermes-disconnected', () => {
      if (active) { setChatStatus('连接中断；请先检查连接，再恢复会话'); setTurnBusy(false); setServerRequests([]) }
    }).then(fn => { if (active) unlistenDisconnect = fn; else fn() })
    return () => { active = false; unlistenEvent?.(); unlistenRequest?.(); unlistenDisconnect?.() }
  }, [])

  async function answerRequest(choice?: ApprovalChoice) {
    if (!serverRequest) return
    const request = serverRequest
    try {
      await invoke('answer_gateway_request', {
        requestId: request.id,
        method: request.method,
        choice,
        answers: request.method === 'clarify' ? clarifyAnswers : undefined,
      })
      setServerRequests(current => current.filter(item => item.id !== request.id))
      setClarifyAnswers({})
      setChatStatus(request.method === 'approval' ? '已提交审批决定' : '已提交澄清回答')
    } catch (cause) { setChatStatus(`处理请求失败：${String(cause)}`) }
  }

  async function sendMessage() {
    const text = draft.trim()
    if (!text || turnBusy) return
    assistantRef.current = ''
    setAssistant('')
    setTurnBusy(true)
    setChatStatus('提交中…')
    try {
      let id = sessionRef.current
      if (!id) {
        id = await invoke<string>('create_chat_session')
        sessionRef.current = id
        setSessionId(id)
      }
      setConversation(rows => [...rows, { role: 'user', text }])
      setDraft('')
      const result = await invoke<{ status?: string }>('submit_chat_prompt', { sessionId: id, text })
      setChatStatus(previous => previous === '回复完成' ? previous : `已接收：${result.status || '等待事件'}`)
    } catch (cause) {
      setChatStatus(`提交失败：${String(cause)}。请先查看历史，避免重复提交。`)
      setTurnBusy(false)
    }
  }

  async function startBackend() {
    setBusy(true)
    setBackendStatus('启动并鉴权中…')
    try {
      const info = await invoke<BackendInfo>('start_dev_backend', { pythonPath, storagePath })
      setBackend(info)
      setBackendStatus('已就绪：WebSocket ping 通过')
    } catch (cause) {
      setBackend(null)
      sessionRef.current = ''
      setSessionId('')
      setConversation([])
      assistantRef.current = ''
      setAssistant('')
      setServerRequests([])
      setBackendStatus(`启动失败：${String(cause)}`)
    } finally { setBusy(false) }
  }

  async function pingBackend() {
    setBusy(true)
    try {
      await invoke('ping_backend')
      setBackendStatus('连接正常：WebSocket ping 通过')
    } catch (cause) { setBackendStatus(`连接失败：${String(cause)}`) }
    finally { setBusy(false) }
  }

  async function stopBackend() {
    setBusy(true)
    try {
      await invoke('stop_backend')
      setBackend(null)
      sessionRef.current = ''
      setSessionId('')
      setConversation([])
      assistantRef.current = ''
      setAssistant('')
      setServerRequests([])
      setBackendStatus('已停止')
    } catch (cause) { setBackendStatus(`停止失败：${String(cause)}`) }
    finally { setBusy(false) }
  }

  return <main>
    <header><span className="eyebrow">I0 技术样机</span><h1>Hermess Agent Desktop</h1></header>
    <p>正在建立独立运行时。当前页面只显示本机工具检测结果；后端尚未准备时不提供虚假的聊天入口。</p>
    <section>
      <div className="row"><h2>本机工具</h2><button onClick={() => void inspect()} disabled={loading}>{loading ? '检测中…' : '重新检测'}</button></div>
      {error && <p role="alert">检测失败：{error}</p>}
      <ul>{probes.map(probe => <li key={probe.tool}>
        <strong>{probe.tool}</strong><span>{probe.usable ? '可复用候选' : '不可复用'}</span>
        <small>{probe.version ?? probe.reason}</small>
        {probe.path && <code>{probe.path}</code>}
      </li>)}</ul>
    </section>
    {import.meta.env.DEV && <section>
      <h2>开发态后端连接</h2>
      <p>只使用本产品 .build 中已准备的隔离环境。存储目录会创建产品专用子目录。</p>
      <label>Python 绝对路径<input value={pythonPath} onChange={event => setPythonPath(event.target.value)} /></label>
      <label>主要存储位置<input value={storagePath} onChange={event => setStoragePath(event.target.value)} /></label>
      <div className="actions">
        <button disabled={busy || !pythonPath || !storagePath} onClick={() => void startBackend()}>启动</button>
        <button disabled={busy || !backend} onClick={() => void pingBackend()}>检查连接</button>
        <button disabled={busy || !backend} onClick={() => void stopBackend()}>停止</button>
      </div>
      <p role="status">{backendStatus}{backend && `（PID ${backend.pid}，端口 ${backend.port}）`}</p>
    </section>}
    {import.meta.env.DEV && backend && <section>
      <h2>最小聊天链路</h2>
      <p>使用固定提交的会话和消息 RPC。模型需先在该独立 Hermes 数据根配置；历史恢复和附件尚未接入。</p>
      {sessionId && <small>会话：{sessionId}</small>}
      <div className="messages">{conversation.map((message, index) =>
        <p key={index}><strong>{message.role === 'user' ? '你' : 'Hermes'}：</strong>{message.text}</p>
      )}{assistant && <p><strong>Hermes：</strong>{assistant}</p>}</div>
      {serverRequest?.method === 'approval' && <div className="request-card" role="alertdialog" aria-label="工具执行审批">
        <strong>工具执行审批</strong>
        <p>{serverRequest.params.description || serverRequest.params.tool_name || 'Hermes 请求执行工具'}</p>
        {serverRequest.params.command && <pre>{serverRequest.params.command}</pre>}
        <div className="actions">{(serverRequest.params.choices || ['deny']).map(choice =>
          <button key={choice} onClick={() => void answerRequest(choice)}>{({ once: '仅本次允许', session: '本会话允许', always: '始终允许', deny: '拒绝' })[choice]}</button>
        )}</div>
      </div>}
      {serverRequest?.method === 'clarify' && <div className="request-card" role="group" aria-label="澄清问题">
        <strong>Hermes 需要补充信息</strong>
        {(serverRequest.params.questions || []).map(question => <label key={question.qid}>{question.question}
          {question.choices?.length ? <select value={clarifyAnswers[question.qid] || ''} onChange={event => setClarifyAnswers(previous => ({ ...previous, [question.qid]: event.target.value }))}>
            <option value="">请选择</option>{question.choices.map(option => <option key={option} value={option}>{option}</option>)}
          </select> : <input value={clarifyAnswers[question.qid] || ''} onChange={event => setClarifyAnswers(previous => ({ ...previous, [question.qid]: event.target.value }))} />}
        </label>)}
        <button onClick={() => void answerRequest()}>提交回答</button>
      </div>}
      <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="输入消息" rows={3} />
      <div className="actions"><button disabled={turnBusy || !draft.trim()} onClick={() => void sendMessage()}>发送</button></div>
      <p role="status">{chatStatus}</p>
    </section>}
    <p className="note">检测结果仅是候选；Hermes 固定版本的依赖环境与真实启动仍需单独验收。</p>
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
