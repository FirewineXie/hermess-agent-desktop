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

function App() {
  const [probes, setProbes] = React.useState<RuntimeProbe[]>([])
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)

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

  React.useEffect(() => { void inspect() }, [])

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
    <p className="note">检测结果仅是候选；Hermes 固定版本的依赖环境与真实启动仍需单独验收。</p>
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
