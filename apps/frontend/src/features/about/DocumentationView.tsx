import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

const DOCUMENTATION_URL = 'https://hermes-agent.nousresearch.com/docs/'

export default function DocumentationView() {
  const { links } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  async function openDocumentation() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await links.openDocumentation()
    } catch (nextError) {
      setError(nextError)
    } finally {
      setBusy(false)
    }
  }

  return <section className="settings-panel about-panel">
    <h2>{zh ? '官方文档' : 'Documentation'}</h2>
    <p>{zh
      ? '查看 Hermes Agent 的官方使用说明、工具能力、配置格式和开发文档。'
      : 'Read the official Hermes Agent guides, tool capabilities, configuration reference, and developer documentation.'}</p>
    <div className="about-content">
      <div className="about-card">
        <strong>Hermes Agent Documentation</strong>
        <p>{zh
          ? '文档将在系统默认浏览器中打开。桌面端不会在应用内嵌入远程网页，也不会把当前 Profile 的凭据传给文档站点。'
          : 'Documentation opens in your default browser. The desktop app does not embed the remote site or send Profile credentials to it.'}</p>
        <code className="about-monospace">{DOCUMENTATION_URL}</code>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void openDocumentation()}>
            {busy ? (zh ? '正在打开…' : 'Opening…') : (zh ? '在浏览器中打开' : 'Open in browser')}
          </button>
        </div>
      </div>
      {error !== null && <p role="alert">{describeError(error, language)}</p>}
    </div>
  </section>
}
