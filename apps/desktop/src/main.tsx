import React from 'react'
import ReactDOM from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
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

function App() {
  const [probes, setProbes] = React.useState<RuntimeProbe[]>([])
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [pythonPath, setPythonPath] = React.useState('')
  const [storagePath, setStoragePath] = React.useState('')
  const [backend, setBackend] = React.useState<BackendInfo | null>(null)
  const [backendStatus, setBackendStatus] = React.useState('未启动')
  const [busy, setBusy] = React.useState(false)

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

  async function startBackend() {
    setBusy(true)
    setBackendStatus('启动并鉴权中…')
    try {
      const info = await invoke<BackendInfo>('start_dev_backend', { pythonPath, storagePath })
      setBackend(info)
      setBackendStatus('已就绪：WebSocket ping 通过')
    } catch (cause) {
      setBackend(null)
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
    <p className="note">检测结果仅是候选；Hermes 固定版本的依赖环境与真实启动仍需单独验收。</p>
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
