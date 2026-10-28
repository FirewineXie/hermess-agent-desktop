import React, { type ReactNode } from 'react'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { settingsPages, type SettingsPage } from './model'
import './unified-settings.css'

type Props = {
  language: Language
  page: SettingsPage
  connected: boolean
  profile: string | null
  profiles: Array<{ name: string; display_name?: string }>
  profileBusy: boolean
  onSelectProfile: (name: string) => Promise<boolean>
  onNavigate: (page: SettingsPage) => boolean
  onExit: () => void
  children: ReactNode
}

export default function SettingsView({ language, page, connected, profile, profiles, profileBusy, onSelectProfile, onNavigate, onExit, children }: Props) {
  const zh = language === 'zh-CN'
  const [error, setError] = React.useState('')
  const request = React.useRef(0)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const category = settingsPages.find(item => item.id === page)?.category || 'models'
  const navigate = (next: SettingsPage) => {
    if (onNavigate(next)) contentRef.current?.scrollTo({ top: 0 })
  }
  React.useEffect(() => { ++request.current; setError('') }, [profile, connected])
  const selectProfile = (name: string) => {
    const current = ++request.current
    setError('')
    void onSelectProfile(name).catch(cause => {
      if (current === request.current) setError(describeError(cause, language))
    })
  }
  return <section className="unified-settings" aria-label={zh ? '设置' : 'Settings'}>
    <aside className="settings-category-nav" aria-label={zh ? '设置分类' : 'Settings categories'}>
      <div className="settings-nav-heading"><button type="button" onClick={onExit}>{zh ? '← 返回' : '← Back'}</button><strong>{zh ? '设置' : 'Settings'}</strong></div>
      <button type="button" className={category === 'models' ? 'selected' : ''} onClick={() => navigate('providers')}>{zh ? '模型' : 'Models'}</button>
      <button type="button" className={category === 'runtime' ? 'selected' : ''} onClick={() => navigate('runtime')}>{zh ? '运行时与存储' : 'Runtime & storage'}</button>
      <button type="button" className={category === 'about' ? 'selected' : ''} onClick={() => navigate('about')}>{zh ? '关于' : 'About'}</button>
    </aside>
    <div className="settings-main">
      <header className="settings-content-heading">
        <div><h1>{category === 'models' ? (zh ? '模型' : 'Models') : category === 'runtime' ? (zh ? '运行时与存储' : 'Runtime & storage') : (zh ? '关于' : 'About')}</h1>
          <p>{category === 'models' ? (zh ? '当前 Profile 的提供商与模型配置' : 'Providers and models for the selected Profile') : ''}</p></div>
        {category === 'models' && <label className="settings-profile-scope">{zh ? '当前 Profile' : 'Current Profile'}
          <select value={profile || ''} disabled={!connected || profileBusy || profiles.length === 0} onChange={event => selectProfile(event.target.value)}>
            {!profile && <option value="">{zh ? '未选择' : 'Not selected'}</option>}
            {profiles.map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}
          </select><small>{zh ? '提供商与模型配置按 Profile 隔离' : 'Providers and models are isolated by Profile'}</small>
          {error && <small role="alert">{error}</small>}
        </label>}
      </header>
      {category === 'models' && <nav className="settings-subpage-nav" aria-label={zh ? '模型设置子页' : 'Model settings pages'}>
        {settingsPages.filter(item => item.category === 'models').map(item => <button key={item.id} type="button" className={page === item.id ? 'selected' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{zh ? item.zh : item.en}</button>)}
      </nav>}
      <div ref={contentRef} className="settings-content-scroll">{children}</div>
    </div>
  </section>
}
