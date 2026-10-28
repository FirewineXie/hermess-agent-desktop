import { useLanguage, translateApp } from '../i18n'
import type { View } from './types'
import { sessionSourceLabel } from '../features/chat/sessionSource'
import { useDesktop } from './DesktopContext'
import windowIcon from '../assets/hermess-window-icon.png'

export default function WorkspaceHeader({ view, sessionTitle, sessionSource, connected, updateVersion, onOpenNavigation, onOpenView, onOpenUpdate }: { view: View; sessionTitle?: string; sessionSource?: string; connected: boolean; updateVersion: string | null; onOpenNavigation: () => void; onOpenView: (view: View) => void; onOpenUpdate: () => void }) {
  const { links, windowChrome } = useDesktop()
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const title = view === 'chat' ? sessionTitle || t('ui.chat') : ({
    usage: t('ui.usage.title'),
    workspaces: t('ui.workspace.title'),
    scheduled: language === 'zh-CN' ? '定时任务' : 'Scheduled tasks',
    settings: language === 'zh-CN' ? '设置' : 'Settings',
    agent: t('ui.agent.settings'),
    profiles: language === 'zh-CN' ? '角色与 Profile' : 'Roles and profiles',
    memory: t('ui.persona.and.memory'),
    runtime: t('ui.runtime.and.storage'),
    tools: t('ui.tools.and.capabilities'),
    extensions: t('ui.extensions'),
    channels: t('ui.channels'),
    about: t('ui.about'),
  })[view]
  return <header className="workspace-header">
    <button className="menu-toggle" aria-label={t('ui.open.navigation')} onClick={onOpenNavigation}>☰</button>
    {windowChrome.customTitlebar ? <>
      <img className="window-title-icon" src={windowIcon} alt="" draggable={false} data-tauri-drag-region />
      <span className="window-title-text" data-tauri-drag-region onDoubleClick={() => void windowChrome.toggleMaximize()}>Hermess Agent Desktop</span>
      <span className={`window-title-status-dot ${connected ? 'ready' : ''}`} aria-hidden="true" data-tauri-drag-region />
      <span className="window-title-location" data-tauri-drag-region>{language === 'zh-CN' ? '本地' : 'Local'}</span>
      <span className="window-title-connection" data-tauri-drag-region>{connected ? t('ui.connected') : t('ui.not.started')}</span>
      <div className="window-title-drag" data-tauri-drag-region onDoubleClick={() => void windowChrome.toggleMaximize()} />
    </> : <>
      <div className="header-brand"><span className="header-brand-mark">H</span><strong>Hermess <span>Desktop</span></strong></div>
      <div className="header-location"><span className={`status-dot ${connected ? 'ready' : ''}`} /><span>{language === 'zh-CN' ? '本地' : 'Local'}</span><small>{connected ? t('ui.connected') : t('ui.not.started')}</small></div>
      {view === 'chat' && sessionTitle && <span className="header-session-title">{title}{sessionSourceLabel(sessionSource, language) && <span className="session-source header-source">{sessionSourceLabel(sessionSource, language)}</span>}</span>}
    </>}
    <button className="header-github" type="button" onClick={() => void links.openRepository()} aria-label="GitHub" title="GitHub">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.94-2.64 3.14 3.14 0 0 0-.08-2.64S19.73 3.3 17.09 5a13.38 13.38 0 0 0-10.18 0C4.27 3.3 4.02 3.82 4.02 3.82a3.14 3.14 0 0 0-.08 2.64A3.4 3.4 0 0 0 3 9.1V13a6 6 0 0 0 6 6v3" /></svg>
    </button>
    <button className={`header-link ${updateVersion ? 'has-update' : ''}`} type="button" aria-label={updateVersion ? (language === 'zh-CN' ? `发现新版本 ${updateVersion}，查看更新` : `Version ${updateVersion} available, view update`) : undefined} title={updateVersion ? (language === 'zh-CN' ? `发现新版本 ${updateVersion}` : `Version ${updateVersion} available`) : undefined} onClick={onOpenUpdate}>
      {language === 'zh-CN' ? '更新' : 'Updates'}{updateVersion && <span className="header-update-badge" aria-hidden="true">↓</span>}
    </button>
    <button type="button" className="header-settings" aria-label={language === 'zh-CN' ? '系统设置' : 'System settings'} title={language === 'zh-CN' ? '系统设置' : 'System settings'} onClick={() => onOpenView('settings')}>⚙</button>
    {windowChrome.customTitlebar && <div className="window-controls" role="group" aria-label={language === 'zh-CN' ? '窗口控制' : 'Window controls'}>
      <button type="button" aria-label={language === 'zh-CN' ? '最小化窗口' : 'Minimize window'} title={language === 'zh-CN' ? '最小化' : 'Minimize'} onClick={() => void windowChrome.minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12h10" /></svg></button>
      <button type="button" aria-label={language === 'zh-CN' ? '最大化或还原窗口' : 'Maximize or restore window'} title={language === 'zh-CN' ? '最大化或还原' : 'Maximize or restore'} onClick={() => void windowChrome.toggleMaximize()}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" /></svg></button>
      <button type="button" className="window-close" aria-label={language === 'zh-CN' ? '关闭窗口并收起到托盘' : 'Close window to tray'} title={language === 'zh-CN' ? '收起到托盘' : 'Close to tray'} onClick={() => void windowChrome.close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" /></svg></button>
    </div>}
  </header>
}
