import { useLanguage, changeLanguage, translateApp, type Language } from '../i18n'
import type { View } from './types'
import { sessionSourceLabel } from '../features/chat/sessionSource'

export default function WorkspaceHeader({ view, sessionTitle, sessionSource, connected, onOpenNavigation }: { view: View; sessionTitle?: string; sessionSource?: string; connected: boolean; onOpenNavigation: () => void }) {
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const title = view === 'chat' ? sessionTitle || t('ui.chat') : ({
    usage: t('ui.usage.title'),
    workspaces: t('ui.workspace.title'),
    model: t('ui.model.settings'),
    agent: t('ui.agent.settings'),
    memory: t('ui.persona.and.memory'),
    runtime: t('ui.runtime.and.storage'),
    tools: t('ui.tools.and.capabilities'),
    extensions: t('ui.extensions'),
    channels: t('ui.channels'),
    about: t('ui.about'),
  })[view]
  return <header className="workspace-header">
    <button className="menu-toggle" aria-label={t('ui.open.navigation')} onClick={onOpenNavigation}>☰</button>
    <div><span className="workspace-kicker">Hermess Agent Desktop</span><h1>{title}{view === 'chat' && sessionSourceLabel(sessionSource, language) && <span className="session-source header-source">{sessionSourceLabel(sessionSource, language)}</span>}</h1></div>
    <label className="language-switch">
      <span>{t('ui.language')}</span>
      <select aria-label={t('ui.language')} value={language} onChange={event => changeLanguage(event.target.value as Language)}>
        <option value="zh-CN">{t('ui.simplified.chinese')}</option><option value="en-US">{t('ui.english')}</option>
      </select>
    </label>
    <span className={`connection-badge ${connected ? 'connected' : ''}`}>{connected ? t('ui.connected') : t('ui.not.started')}</span>
  </header>
}
