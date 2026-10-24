import { useLanguage, changeLanguage, translateApp, type Language } from '../i18n'
import type { View } from './types'

export default function WorkspaceHeader({ view, sessionTitle, connected, onOpenNavigation }: { view: View; sessionTitle?: string; connected: boolean; onOpenNavigation: () => void }) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const title = view === 'chat' ? sessionTitle || t('ui.chat') : ({
    model: t('ui.model.settings'),
    agent: t('ui.agent.settings'),
    runtime: t('ui.runtime.and.storage'),
    tools: t('ui.tools.and.capabilities'),
  })[view]
  return <header className="workspace-header">
    <button className="menu-toggle" aria-label={t('ui.open.navigation')} onClick={onOpenNavigation}>☰</button>
    <div><span className="workspace-kicker">Hermess Agent Desktop</span><h1>{title}</h1></div>
    <label className="language-switch">
      <span>{t('ui.language')}</span>
      <select aria-label={t('ui.language')} value={language} onChange={event => changeLanguage(event.target.value as Language)}>
        <option value="zh-CN">{t('ui.simplified.chinese')}</option><option value="en-US">{t('ui.english')}</option>
      </select>
    </label>
    <span className={`connection-badge ${connected ? 'connected' : ''}`}>{connected ? t('ui.connected') : t('ui.not.started')}</span>
  </header>
}
