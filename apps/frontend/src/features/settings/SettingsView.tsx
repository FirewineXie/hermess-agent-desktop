import React, { type ReactNode } from 'react'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { SETTINGS_CATEGORIES, normalizeSettingsLocation, type SettingsLocation } from './model'
import SettingsSearch from './SettingsSearch'
import { SettingsSearchTarget, type SettingsFieldTarget } from './SettingsSearchTarget'

type Props = {
  language: Language
  location: SettingsLocation
  profile: string | null
  connected: boolean
  profiles: Array<{ name: string; display_name?: string }>
  profileBusy: boolean
  onSelectProfile: (name: string) => Promise<boolean>
  onNavigate: (location: SettingsLocation) => boolean
  onExit: () => void
  children: ReactNode
}

export default function SettingsView({ language, location: input, profile, connected, profiles, profileBusy, onSelectProfile, onNavigate, onExit, children }: Props) {
  const location = normalizeSettingsLocation(input)
  const active = SETTINGS_CATEGORIES.find(item => item.id === location.category) || SETTINGS_CATEGORIES[0]
  const [target, setTarget] = React.useState<SettingsFieldTarget | null>(null)
  const [profileError, setProfileError] = React.useState('')
  const profileRequest = React.useRef(0)
  const contentRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    profileRequest.current += 1
    setProfileError('')
    setTarget(null)
  }, [profile, connected])
  function navigate(next: SettingsLocation, field?: string) {
    const accepted = onNavigate(next)
    if (accepted) {
      setTarget(field ? { location: next, field } : null)
      contentRef.current?.scrollTo({ top: 0 })
    }
    return accepted
  }
  return <SettingsSearchTarget.Provider value={target}><section className="unified-settings" aria-label={language === 'zh-CN' ? '设置' : 'Settings'}>
    <aside className="settings-category-nav" aria-label={language === 'zh-CN' ? '设置分类' : 'Settings categories'}>
      <div className="settings-nav-heading">
        <button type="button" className="settings-exit" onClick={onExit}>{language === 'zh-CN' ? '← 返回' : '← Back'}</button>
        <strong>{language === 'zh-CN' ? '设置' : 'Settings'}</strong>
        <small>{connected
          ? (profile ? `Profile · ${profile}` : (language === 'zh-CN' ? '未选择 Profile' : 'No Profile selected'))
          : (language === 'zh-CN' ? '运行时未连接' : 'Runtime disconnected')}</small>
      </div>
      {SETTINGS_CATEGORIES.map(category => <button key={category.id} type="button" className={category.id === active.id ? 'selected' : ''}
        onClick={() => navigate({ category: category.id, subpage: category.subpages[0].id })}>
        <span>{category.label[language]}</span><small>{category.description[language]}</small>
      </button>)}
    </aside>
    <div className="settings-main">
      <header className="settings-content-heading">
        <div className="settings-heading-copy"><h1>{active.label[language]}</h1><p>{active.description[language]}</p>
          <SettingsSearch language={language} connected={connected} profile={profile} onSelect={navigate} />
        </div>
        <label className={`settings-profile-scope ${connected ? 'ready' : ''}`}>
          <span>{language === 'zh-CN' ? '当前 Profile' : 'Current Profile'}</span>
          <select aria-label={language === 'zh-CN' ? '当前设置 Profile' : 'Current settings Profile'} value={profile || ''} disabled={!connected || profileBusy || profiles.length === 0}
            onChange={event => {
              const request = ++profileRequest.current
              setProfileError('')
              void onSelectProfile(event.target.value).then(accepted => {
                if (request === profileRequest.current && accepted) setTarget(null)
              }).catch(error => {
                if (request === profileRequest.current) setProfileError(describeError(error, language))
              })
            }}>
            {!profile && <option value="">{language === 'zh-CN' ? '未选择' : 'Not selected'}</option>}
            {profiles.map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}
          </select>
          <small>{language === 'zh-CN' ? '提供商、凭据与 Agent 配置按 Profile 隔离' : 'Providers, credentials, and agent settings are isolated by Profile'}</small>
          {profileError && <small className="settings-profile-error" role="alert">{profileError}</small>}
        </label>
      </header>
      <nav className="settings-subpage-nav" aria-label={language === 'zh-CN' ? `${active.label[language]}子页` : `${active.label[language]} subpages`}>
        {active.subpages.map(subpage => <button key={subpage.id} type="button" className={subpage.id === location.subpage ? 'selected' : ''}
          onClick={() => navigate({ category: active.id, subpage: subpage.id })}>{subpage.label[language]}</button>)}
      </nav>
      <div ref={contentRef} className="settings-content-scroll">{children}</div>
    </div>
  </section></SettingsSearchTarget.Provider>
}

export function SettingsCapabilityNotice({ language, title, detail, available = false }: { language: Language; title: string; detail: string; available?: boolean }) {
  return <div className={`settings-capability-notice ${available ? 'available' : ''}`} role="status">
    <strong>{title}</strong><p>{detail}</p>
    {!available && <span>{language === 'zh-CN' ? '当前锁定运行时或桌面宿主尚未提供可验证的能力，因此没有放出无效开关。' : 'The locked runtime or desktop host does not yet expose a verifiable capability, so no non-functional control is shown.'}</span>}
  </div>
}
