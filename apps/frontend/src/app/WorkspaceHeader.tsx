import { useLanguage, translateApp } from '../i18n'
import type { View } from './types'
import { sessionSourceLabel } from '../features/chat/sessionSource'
import { useDesktop } from './DesktopContext'
import windowIcon from '../assets/hermess-window-icon.png'
import { DashboardPluginSlot } from '../features/dashboard-plugins/DashboardPluginHost'
import GatewaySwitcher from './GatewaySwitcher'
import type { ActiveGateway } from '@hermess/contracts'
import Icon from './Icon'

export default function WorkspaceHeader({ view, sessionTitle, sessionSource, pluginTitle, connected, connectionLabel, gateway, updateVersion, onOpenNavigation, onOpenView, onOpenUpdate, onOpenCommandPalette, onSwitchGateway, onConfigureRemote, onOpenHostTerminals }: { view: View; sessionTitle?: string; sessionSource?: string; pluginTitle?: string; connected: boolean; connectionLabel?: string; gateway: ActiveGateway; updateVersion: string | null; onOpenNavigation: () => void; onOpenView: (view: View) => void; onOpenUpdate: () => void; onOpenCommandPalette: () => void; onSwitchGateway: (id: string | null) => void; onConfigureRemote: () => void; onOpenHostTerminals?: () => void }) {
  const { links, windowChrome } = useDesktop()
  const language = useLanguage()
  const t = (key: string) => translateApp(language, key)
  const title = view === 'dashboard-plugin' ? pluginTitle || 'Dashboard Plugin' : view === 'chat' ? sessionTitle || t('ui.chat') : ({
    sessions: language === 'zh-CN' ? '会话管理' : 'Sessions',
    bots: language === 'zh-CN' ? 'Bot 模式' : 'Bot Mode',
    files: language === 'zh-CN' ? '文件管理' : 'Files',
    usage: t('ui.usage.title'),
    workspaces: t('ui.workspace.title'),
    scheduled: language === 'zh-CN' ? '定时任务' : 'Scheduled tasks',
    'personal-tasks': language === 'zh-CN' ? '持续任务' : 'Ongoing tasks',
    webhooks: 'Webhooks',
    settings: language === 'zh-CN' ? '设置' : 'Settings',
    agent: t('ui.agent.settings'),
    profiles: language === 'zh-CN' ? '角色与 Profile' : 'Roles and profiles',
    memory: t('ui.persona.and.memory'),
    journey: language === 'zh-CN' ? '学习时间线' : 'Learning timeline',
    runtime: t('ui.runtime.and.storage'),
    extensions: t('ui.extensions'),
    channels: t('ui.channels'),
    about: t('ui.about'),
  })[view]
  return <header className="workspace-header">
    <button className="menu-toggle" aria-label={t('ui.open.navigation')} onClick={onOpenNavigation}><Icon name="menu" /></button>
    {windowChrome.customTitlebar ? <>
      <DashboardPluginSlot name="header-left" />
      <img className="window-title-icon" src={windowIcon} alt="" draggable={false} data-tauri-drag-region />
      <span className="window-title-text" data-tauri-drag-region onDoubleClick={() => void windowChrome.toggleMaximize()}>Hermess Agent Desktop</span>
      <GatewaySwitcher gateway={gateway} connected={connected} onSwitch={onSwitchGateway} onConfigure={onConfigureRemote} />
      <span className="window-title-connection" data-tauri-drag-region>{connectionLabel || (connected ? t('ui.connected') : t('ui.not.started'))}</span>
      <div className="window-title-drag" data-tauri-drag-region onDoubleClick={() => void windowChrome.toggleMaximize()} />
    </> : <>
      <DashboardPluginSlot name="header-left" />
      <div className="header-brand"><span className="header-brand-mark">H</span><strong>Hermess <span>Desktop</span></strong></div>
      <GatewaySwitcher gateway={gateway} connected={connected} onSwitch={onSwitchGateway} onConfigure={onConfigureRemote} />
      {view === 'chat' && sessionTitle && <span className="header-session-title">{title}{sessionSourceLabel(sessionSource, language) && <span className="session-source header-source">{sessionSourceLabel(sessionSource, language)}</span>}</span>}
    </>}
    <button className="header-command-palette" type="button" aria-label={language === 'zh-CN' ? '搜索会话、页面、设置和操作' : 'Search sessions, pages, settings and actions'} title={language === 'zh-CN' ? '打开命令面板 (Ctrl/⌘ K)' : 'Open command palette (Ctrl/⌘ K)'} onClick={onOpenCommandPalette}><Icon name="search" /><span>{language === 'zh-CN' ? '搜索' : 'Search'}</span><kbd>Ctrl/⌘ K</kbd></button>
    <button className="header-github" type="button" onClick={() => void links.openRepository()} aria-label="GitHub" title="GitHub">
      <Icon name="github" />
    </button>
    {gateway.mode === 'local' && updateVersion && <button className="header-link header-update" type="button" aria-label={language === 'zh-CN' ? `发现新版本 ${updateVersion}，查看软件更新` : `Version ${updateVersion} available, view software updates`} title={language === 'zh-CN' ? `发现新版本 ${updateVersion}，查看软件更新` : `Version ${updateVersion} available, view software updates`} onClick={onOpenUpdate}>
      <Icon name="refresh" />
      <span className="header-update-dot" aria-hidden="true" />
    </button>}
    <DashboardPluginSlot name="header-right" />
    {onOpenHostTerminals && <button className="header-link" type="button" aria-label={language === 'zh-CN' ? '打开主机终端' : 'Open host terminals'} title={language === 'zh-CN' ? '主机终端' : 'Host terminals'} onClick={onOpenHostTerminals}><Icon name="terminal" /></button>}
    {gateway.mode === 'local' && <button type="button" className="header-settings" aria-label={language === 'zh-CN' ? '系统设置' : 'System settings'} title={language === 'zh-CN' ? '系统设置' : 'System settings'} onClick={() => onOpenView('settings')}>
      <Icon name="settings" />
    </button>}
    {windowChrome.customTitlebar && <div className="window-controls" role="group" aria-label={language === 'zh-CN' ? '窗口控制' : 'Window controls'}>
      <button type="button" aria-label={language === 'zh-CN' ? '最小化窗口' : 'Minimize window'} title={language === 'zh-CN' ? '最小化' : 'Minimize'} onClick={() => void windowChrome.minimize()}><Icon name="minus" /></button>
      <button type="button" aria-label={language === 'zh-CN' ? '最大化或还原窗口' : 'Maximize or restore window'} title={language === 'zh-CN' ? '最大化或还原' : 'Maximize or restore'} onClick={() => void windowChrome.toggleMaximize()}><Icon name="square" /></button>
      <button type="button" className="window-close" aria-label={language === 'zh-CN' ? '关闭窗口并收起到托盘' : 'Close window to tray'} title={language === 'zh-CN' ? '收起到托盘' : 'Close to tray'} onClick={() => void windowChrome.close()}><Icon name="close" /></button>
    </div>}
  </header>
}
