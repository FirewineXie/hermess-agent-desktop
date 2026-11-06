import React from 'react'
import type { Language } from '../../i18n'
import { type AppearanceFont, type AppearanceTheme } from './appearanceModel'
import { initializeAppearance, readAppearance, saveAppearance, subscribeAppearance } from './appearanceRuntime'
import './appearance.css'

initializeAppearance()

export default function AppearanceSettings({ language }: { language: Language }) {
  const zh = language === 'zh-CN'
  const [preference, setPreference] = React.useState(readAppearance)
  const [status, setStatus] = React.useState('')
  React.useEffect(() => subscribeAppearance(setPreference), [])

  function save(patch: { theme?: AppearanceTheme; font?: AppearanceFont }) {
    const next = { ...preference, ...patch }
    try {
      saveAppearance(next); setPreference(next)
      setStatus(zh ? '外观偏好已保存在此设备。' : 'Appearance saved on this device.')
    } catch (error) {
      console.error('[appearance] preference save failed', error)
      setStatus(zh ? '保存外观偏好失败，已保留当前选择。' : 'Could not save appearance; the current selection was kept.')
    }
  }

  return <section className="appearance-settings" aria-labelledby="appearance-title">
    <div><h3 id="appearance-title">{zh ? '外观' : 'Appearance'}</h3><p>{zh ? '全局应用于本设备，不随 Profile 切换，也不会写入 Hermes 配置。' : 'Applies globally on this device, does not follow Profile changes, and is not written to Hermes configuration.'}</p></div>
    <fieldset><legend>{zh ? '颜色主题' : 'Color theme'}</legend><div className="appearance-options">{([
      ['system', zh ? '跟随系统' : 'System', zh ? '随 Windows 或 macOS 外观切换' : 'Follow Windows or macOS appearance'],
      ['light', zh ? '浅色' : 'Light', zh ? '暖白画布和浅灰侧栏' : 'Warm white canvas and soft gray sidebar'],
      ['dark', zh ? '深色' : 'Dark', zh ? '低亮度深色工作区' : 'Low-luminance dark workspace'],
    ] as const).map(([value, label, detail]) => <label key={value} className={preference.theme === value ? 'selected' : ''}>
      <input type="radio" name="appearance-theme" value={value} checked={preference.theme === value} onChange={() => save({ theme: value })} />
      <span><strong>{label}</strong><small>{detail}</small></span>
    </label>)}</div></fieldset>
    <label className="appearance-font"><span><strong>{zh ? '界面字体' : 'Interface font'}</strong><small>{zh ? '仅使用操作系统自带字体，不下载远程字体。' : 'Uses operating-system fonts only; no remote font download.'}</small></span>
      <select value={preference.font} onChange={event => save({ font: event.target.value as AppearanceFont })}>
        <option value="system-sans">{zh ? '系统无衬线' : 'System sans serif'}</option><option value="system-serif">{zh ? '系统衬线' : 'System serif'}</option><option value="system-mono">{zh ? '系统等宽' : 'System monospace'}</option>
      </select></label>
    {status && <p className="appearance-status" role="status">{status}</p>}
  </section>
}
