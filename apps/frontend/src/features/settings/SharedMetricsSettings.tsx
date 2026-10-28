import React from 'react'
import type { SharedMetricsConsent } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'

export default function SharedMetricsSettings({ profile, connected }: { profile: string | null; connected: boolean }) {
  const { privacy } = useDesktop()
  const language = useLanguage()
  const [consent, setConsent] = React.useState<SharedMetricsConsent | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')

  React.useEffect(() => {
    let active = true
    setLoaded(false)
    setConsent(null)
    setStatus('')
    if (!connected || !profile) return () => { active = false }
    void privacy.sharedMetrics({ kind: 'profile', profile }).then(value => {
      if (active) setConsent(value)
    }).catch(() => {
      if (active) setConsent(null)
    }).finally(() => {
      if (active) setLoaded(true)
    })
    return () => { active = false }
  }, [connected, profile, privacy])

  const save = async (enabled: boolean) => {
    if (!profile || !consent) return
    const previous = consent
    setConsent({ enabled, send: enabled, decided: true })
    setBusy(true)
    try {
      const saved = await privacy.saveSharedMetrics({ kind: 'profile', profile }, enabled)
      setConsent(saved)
      setStatus(language === 'zh-CN' ? '共享指标偏好已由当前 Profile 的 Gateway 确认' : 'The current Profile Gateway confirmed the shared-metrics preference')
    } catch (error) {
      setConsent(previous)
      setStatus(describeError(error, language))
    } finally { setBusy(false) }
  }

  const unavailable = loaded && consent === null
  return <section className="notification-settings">
    <h2>{language === 'zh-CN' ? '共享指标' : 'Shared metrics'}</h2>
    <p>{language === 'zh-CN' ? '这是 Profile 级的两项联动同意：开启时同时允许收集与发送，关闭时同时关闭。状态直接来自 Gateway。' : 'This Profile-scoped consent couples collection and sending. Its state comes directly from the Gateway.'}</p>
    <label className={`notification-row ${unavailable ? 'unavailable' : ''}`}>
      <span><strong>{language === 'zh-CN' ? '发送匿名共享指标' : 'Send anonymous shared metrics'}</strong><small>{unavailable ? (language === 'zh-CN' ? '当前锁定 Gateway 未提供 shared_metrics 接口。' : 'The locked Gateway does not expose shared_metrics methods.') : (language === 'zh-CN' ? '修改会触发 Gateway 的同意写入与状态协调，不是普通本地开关。' : 'This invokes the Gateway consent flow rather than a local-only toggle.')}</small></span>
      <input type="checkbox" checked={Boolean(consent?.send)} disabled={!consent || busy} onChange={event => void save(event.target.checked)} />
    </label>
    <p role="status">{!loaded && connected ? (language === 'zh-CN' ? '正在读取…' : 'Loading…') : status}</p>
  </section>
}
