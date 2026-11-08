import React from 'react'
import type { CodingCatalog, CodingRuntimeStatus, ModelProvider } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import ProgrammingRuntimeProgress from './ProgrammingRuntimeProgress'
import ProgrammingProviders from './ProgrammingProviders'
import './programming.css'

export default function ProgrammingSettings({ language, profiles = [], connected = false, providers = [], onDirtyChange, onBusyChange, onCatalogChange }: {
  language: Language; profiles?: { name: string; display_name?: string }[]; connected?: boolean; providers?: ModelProvider[]; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void
  onCatalogChange: (catalog: CodingCatalog) => void
}) {
  const { coding } = useDesktop()
  const zh = language === 'zh-CN'
  const [runtime, setRuntime] = React.useState<CodingRuntimeStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [providersBusy, setProvidersBusy] = React.useState(false)
  React.useEffect(() => { onBusyChange(busy || providersBusy) }, [busy, providersBusy, onBusyChange])
  const operation = React.useRef(false)
  React.useEffect(() => {
    let active = true
    void coding.runtime().then(r => {
      if (active) setRuntime(r)
    }).catch(cause => { if (active) setError(describeError(cause, language)) })
    return () => { active = false }
  }, [coding, language])
  React.useEffect(() => {
    if (!runtime || !['downloading', 'installing'].includes(runtime.state)) return
    let active = true
    const timer = window.setInterval(() => {
      void coding.runtime().then(value => { if (active) setRuntime(value) }).catch(cause => {
        if (active) setError(describeError(cause, language))
      })
    }, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [coding, runtime?.state, language])
  React.useEffect(() => () => { onDirtyChange(false); onBusyChange(false) }, [onDirtyChange, onBusyChange])
  const execute = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError('')
    try { await action() } catch (cause) { setError(describeError(cause, language)) }
    finally { operation.current = false; setBusy(false) }
  }
  const install = () => execute(async () => {
    setRuntime(current => current ? { ...current, state: 'downloading', downloaded: 0, total: 0 } : current)
    try { await coding.installRuntime() } finally { setRuntime(await coding.runtime()) }
  })
  const states = { missing: '未安装', downloading: '下载中', installing: '校验并安装', installed: '已安装', failed: '下载失败，可重试' }
  const runtimeActive = runtime?.state === 'downloading' || runtime?.state === 'installing'
  return <section className="programming-settings">
    <section className="programming-settings-section">
      <div className="programming-section-title"><div><h2>{zh ? '编程运行时' : 'Programming runtime'}</h2><p>{zh ? '首次使用时下载，独立于你个人安装的编程工具。' : 'Download once. Kept separate from your personal coding tools.'}</p></div>
      {runtime && <span className={`programming-runtime-badge ${runtime.state}`}>{zh ? states[runtime.state] : runtime.state}</span>}</div>
      {runtime ? <>
        <div className="programming-runtime-summary"><span>v{runtime.version}<small>{zh ? '按需运行 · 独立配置与会话目录' : 'On demand · Isolated configuration and chats'}</small></span>
          <button type="button" disabled={busy || runtimeActive || !runtime.supported || runtime.state === 'installed'} onClick={() => void install()}>{runtime.state === 'installed' ? (zh ? '已安装' : 'Installed') : runtime.state === 'installing' ? (zh ? '正在安装…' : 'Installing…') : runtime.state === 'downloading' ? (zh ? '正在下载…' : 'Downloading…') : runtime.state === 'failed' ? (zh ? '重试下载' : 'Retry download') : (zh ? '下载运行时' : 'Download runtime')}</button></div>
        <ProgrammingRuntimeProgress runtime={runtime} language={language} />
        {!runtime.supported && <p className="programming-error" role="alert">{zh ? '当前平台暂不支持' : 'This platform is not supported'}</p>}
        <details className="programming-runtime-source"><summary>{zh ? '版本与下载来源' : 'Version and source'}</summary><p>OpenAI Codex · {runtime.tag}</p><code>https://github.com/openai/codex/releases/tag/{runtime.tag}</code></details>
      </> : <p role="status">{zh ? '正在读取运行时…' : 'Loading runtime…'}</p>}
    </section>
    <ProgrammingProviders language={language} providers={providers} profiles={profiles} connected={connected} onDirtyChange={onDirtyChange} onBusyChange={setProvidersBusy} onCatalogChange={onCatalogChange} />
    {error && <p className="programming-error" role="alert">{error}</p>}
  </section>
}
