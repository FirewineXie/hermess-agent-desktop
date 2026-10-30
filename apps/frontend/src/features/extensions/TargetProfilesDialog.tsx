import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useLanguage } from '../../i18n'
import { keepFocusInside } from './dialogFocus'

type Props = {
  itemName: string
  profiles: ProfilesSnapshot
  alreadyInstalled?: string[]
  unavailable?: string[]
  busy: boolean
  confirmDisabled?: boolean
  onClose: () => void
  onConfirm: (names: string[]) => Promise<void>
  children?: React.ReactNode
}

export default function TargetProfilesDialog({ itemName, profiles, alreadyInstalled = [], unavailable = [], busy, confirmDisabled = false, onClose, onConfirm, children }: Props) {
  const zh = useLanguage() === 'zh-CN'
  const served = new Set(profiles.gateways.flatMap(gateway => [gateway.profile, ...(gateway.served_profiles || [])]))
  const available = profiles.profiles.filter(profile => served.has(profile.name) && !alreadyInstalled.includes(profile.name) && !unavailable.includes(profile.name))
  const [selected, setSelected] = React.useState<string[]>(available.some(profile => profile.name === profiles.selected) ? [profiles.selected] : [])
  const firstRef = React.useRef<HTMLInputElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    const previous = document.body.style.overflow
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    const focusTarget = firstRef.current || closeRef.current
    focusTarget?.focus()
    return () => { document.body.style.overflow = previous; opener?.focus() }
  }, [])

  function toggle(name: string, checked: boolean) {
    setSelected(current => checked ? [...current, name] : current.filter(value => value !== name))
  }

  return <div className="expert-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="target-profiles-dialog" role="dialog" aria-modal="true" aria-labelledby="target-profiles-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose(); else keepFocusInside(event) }}>
      <header><div className="target-profiles-heading"><h2 id="target-profiles-title">{zh ? `添加 ${itemName}` : `Add ${itemName}`}</h2><p>{zh ? `请选择添加到哪些专家，已选择 ${selected.length} 个` : `Choose experts to add this to. ${selected.length} selected.`}</p></div><button ref={closeRef} type="button" aria-label={zh ? '关闭' : 'Close'} disabled={busy} onClick={onClose}>×</button></header>
      <div className="target-profiles-dialog-body">
        <div className="target-profiles-list">{profiles.profiles.map(profile => <label key={profile.name} className={!served.has(profile.name) || alreadyInstalled.includes(profile.name) || unavailable.includes(profile.name) ? 'unavailable' : ''}>
          <input ref={available[0]?.name === profile.name ? firstRef : undefined} type="checkbox" disabled={busy || !served.has(profile.name) || alreadyInstalled.includes(profile.name) || unavailable.includes(profile.name)} checked={selected.includes(profile.name)} onChange={event => toggle(profile.name, event.target.checked)} />
          <span className="target-profile-avatar" aria-hidden="true">{(profile.display_name || profile.name).slice(0, 1).toUpperCase()}</span>
          <span>{profile.display_name || profile.name}</span>
          {!served.has(profile.name) ? <small>{zh ? '待启用' : 'Not serving'}</small> : alreadyInstalled.includes(profile.name) ? <small>{zh ? '已安装' : 'Installed'}</small> : unavailable.includes(profile.name) && <small>{zh ? '状态读取失败' : 'Status unavailable'}</small>}
        </label>)}</div>
        {children}
      </div>
      <footer><label><input type="checkbox" disabled={busy || !available.length} checked={available.length > 0 && selected.length === available.length} onChange={event => setSelected(event.target.checked ? available.map(profile => profile.name) : [])} />{zh ? '全选' : 'Select all'}</label><button type="button" disabled={busy || confirmDisabled || !selected.length} onClick={() => void onConfirm(selected)}>{busy ? (zh ? '正在添加…' : 'Adding…') : (zh ? '确定' : 'Confirm')}</button></footer>
    </section>
  </div>
}
