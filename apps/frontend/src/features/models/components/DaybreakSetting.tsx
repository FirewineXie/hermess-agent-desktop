import React from 'react'
import { useDesktop } from '../../../app/DesktopContext'
import { describeError } from '../../../app/desktopErrors'
import { useLanguage } from '../../../i18n'

export default function DaybreakSetting({ profile, disabled }: { profile: string; disabled: boolean }) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [enabled, setEnabled] = React.useState<boolean | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let active = true
    void extensions.request<{ enabled: boolean }>({ kind: 'profile', profile }, 'daybreak.status')
      .then(result => { if (active) setEnabled(result.enabled) })
      .catch(cause => { if (active) setError(describeError(cause, language)) })
    return () => { active = false }
  }, [extensions, profile, language])

  async function save(value: boolean) {
    if (disabled || saving || enabled === null) return
    setSaving(true); setError('')
    try {
      const result = await extensions.request<{ enabled: boolean }>({ kind: 'profile', profile }, 'daybreak.set', { enabled: value })
      setEnabled(result.enabled)
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setSaving(false) }
  }

  return <div className="model-picker-daybreak">
    <label><input type="checkbox" checked={enabled === true} disabled={disabled || saving || enabled === null}
      onChange={event => void save(event.target.checked)} /> Daybreak</label>
    <small>{zh ? '适用于此 Profile 中符合资格的 ChatGPT 订阅模型。' : 'Applies to eligible ChatGPT subscription models in this Profile.'}</small>
    {error && <p className="model-picker-message" role="alert">{error}</p>}
  </div>
}
