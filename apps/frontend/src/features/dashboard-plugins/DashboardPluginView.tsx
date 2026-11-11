import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import { describeError } from '../../app/desktopErrors'
import { DashboardPluginPage, refreshDashboardPlugins } from './DashboardPluginHost'
import type { useDashboardPlugins } from './DashboardPluginHost'

type Props = {
  plugin: string | null
  plugins: ReturnType<typeof useDashboardPlugins>
  profiles: ProfilesSnapshot | null
  connected: boolean
  busy: boolean
  onSelectProfile: (name: string) => Promise<void>
  onBack: () => void
  onManage: () => void
}

export default function DashboardPluginView({ plugin, plugins, profiles, connected, busy, onSelectProfile, onBack, onManage }: Props) {
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [switching, setSwitching] = React.useState(false)
  const [switchError, setSwitchError] = React.useState('')
  const manifest = plugins.manifests.find(item => item.name === plugin) || null
  const profile = profiles?.selected || ''
  const selectProfile = async (next: string) => {
    if (!connected || busy || switching || next === profile) return
    setSwitching(true)
    setSwitchError('')
    const context = { plugin, from: profile, to: next }
    console.info('[dashboard-plugin] profile switch started', context)
    try {
      await onSelectProfile(next)
      console.info('[dashboard-plugin] profile switch finished', context)
    } catch (cause) {
      setSwitchError(describeError(cause, language))
      console.error('[dashboard-plugin] profile switch failed', context)
    } finally { setSwitching(false) }
  }
  return <div className="dashboard-plugin-view">
    <header className="dashboard-plugin-navigation">
      <button type="button" onClick={onBack}><span aria-hidden="true">← </span>{zh ? '返回' : 'Back'}</button>
      <strong title={manifest?.label || plugin || ''}>{manifest?.label || plugin || (zh ? 'Dashboard 插件' : 'Dashboard plugin')}</strong>
      <label className="dashboard-plugin-profile">Profile
        <select aria-label={zh ? '插件所属 Profile' : 'Plugin Profile'} value={profile} disabled={!connected || busy || switching || !profiles}
          onChange={event => { void selectProfile(event.target.value) }}>
          {!profile && <option value="">{zh ? '选择 Profile' : 'Select Profile'}</option>}
          {profiles?.profiles.map(item => <option key={item.name} value={item.name}>{item.display_name ? `${item.display_name} (${item.name})` : item.name}</option>)}
        </select>
      </label>
    </header>
    {switchError && <p className="dashboard-plugin-switch-error" role="alert">{switchError}</p>}
    {!connected || switching || plugins.loading || plugins.error || !manifest
      ? <section className="dashboard-plugin-state" aria-live="polite">
        <p role="status">{!connected ? (zh ? '请先连接 Gateway。' : 'Connect to a Gateway first.')
          : switching || plugins.loading ? (zh ? '正在读取当前 Profile 的插件…' : 'Loading plugins for this Profile…')
            : plugins.error || (zh ? '此 Profile 未安装、未启用或已隐藏该插件。' : 'This plugin is not installed, enabled, or visible in this Profile.')}</p>
        {connected && !switching && !plugins.loading && (plugins.error
          ? <button type="button" onClick={() => { if (profile) refreshDashboardPlugins(profile, true) }}>{zh ? '重试' : 'Retry'}</button>
          : <button type="button" disabled={busy} onClick={onManage}>{zh ? '安装或管理插件' : 'Install or manage plugins'}</button>)}
      </section>
      : <DashboardPluginPage key={`${profile}:${plugin}`} manifest={manifest} component={plugin ? plugins.components.get(plugin) : undefined} />}
  </div>
}
