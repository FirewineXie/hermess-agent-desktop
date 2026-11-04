import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './pairing.css'

type PairingUser = {
  platform: string; user_id: string; user_name?: string; request_id?: string; age_minutes?: number
}
type PairingResponse = { pending: PairingUser[]; approved: PairingUser[] }
type Props = {
  connected: boolean; profile: string | null; profiles: ProfilesSnapshot | null; epoch: string | null
  onSelectProfile(name: string): Promise<unknown>
}
const scope = (profile: string) => ({ kind: 'profile' as const, profile })
const label = (user: PairingUser) => user.user_name || user.user_id

export default function PairingView({ connected, profile, profiles, epoch, onSelectProfile }: Props) {
  const { extensions } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [data, setData] = React.useState<PairingResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const generation = React.useRef(0)

  const refresh = React.useCallback(async () => {
    const id = ++generation.current
    if (!connected || !profile) { setData(null); return }
    setLoading(true)
    try {
      const result = await extensions.request<PairingResponse>(scope(profile), 'pairing.list')
      if (generation.current === id) { setData(result); setError('') }
    } catch (cause) {
      if (generation.current === id) setError(describeError(cause, language))
    } finally {
      if (generation.current === id) setLoading(false)
    }
  }, [connected, profile, epoch, extensions, language])

  React.useEffect(() => {
    setData(null); setNotice(''); void refresh()
    return () => { generation.current++ }
  }, [refresh])

  const run = async (operation: string, payload: Record<string, string>, success: string) => {
    if (!profile || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await extensions.request(scope(profile), operation, payload)
      setNotice(success)
      await refresh()
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  const approve = (user: PairingUser) => {
    if (!user.request_id) return
    void run('pairing.approve', { platform: user.platform, request_id: user.request_id },
      zh ? `已批准 ${label(user)}` : `Approved ${label(user)}`)
  }
  const revoke = (user: PairingUser) => {
    if (!window.confirm(zh ? `撤销 ${label(user)} 的访问权限？` : `Revoke access for ${label(user)}?`)) return
    void run('pairing.revoke', { platform: user.platform, user_id: user.user_id },
      zh ? `已撤销 ${label(user)}` : `Revoked ${label(user)}`)
  }
  const clear = () => {
    if (!data?.pending.length || !window.confirm(zh ? `清空当前 Profile 的 ${data.pending.length} 项待审请求？` : `Clear ${data.pending.length} pending requests for this profile?`)) return
    void run('pairing.clearPending', {}, zh ? '待审请求已清空' : 'Pending requests cleared')
  }

  return <main className="pairing-page">
    <header className="pairing-heading"><div><p className="pairing-kicker">HERMESS · ACCESS</p><h1>{zh ? '配对管理' : 'Pairing'}</h1><p>{zh ? '审核消息渠道的新用户，管理已批准的访问权限。' : 'Review messaging requests and manage approved access.'}</p></div><button type="button" className="pairing-clear" disabled={!connected || busy || !data?.pending.length} onClick={clear}>{zh ? '清空待审' : 'Clear pending'}</button></header>
    <div className="pairing-toolbar"><label>Profile <select value={profile || ''} disabled={!connected || busy} onChange={event => { setError(''); void onSelectProfile(event.target.value).catch(cause => setError(describeError(cause, language))) }}>{(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label><button type="button" disabled={!connected || loading || busy} onClick={() => void refresh()}>{loading ? (zh ? '读取中…' : 'Loading…') : (zh ? '刷新' : 'Refresh')}</button></div>
    {!connected && <div className="pairing-empty">{zh ? '请先启动本机 Gateway。' : 'Start the local Gateway first.'}</div>}
    {error && <div className="pairing-error" role="alert">{error}</div>}
    {notice && <div className="pairing-notice" role="status">{notice}</div>}
    {connected && loading && !data && <div className="pairing-empty">{zh ? '正在读取配对记录…' : 'Loading pairing records…'}</div>}
    {connected && data && <div className="pairing-columns">
      <section className="pairing-section"><div className="pairing-section-head"><h2>{zh ? '待审请求' : 'Pending requests'}</h2><span>{data.pending.length}</span></div><p>{zh ? '批准后，用户即可从对应渠道与当前 Profile 交互。' : 'Approved users can interact with this profile through their channel.'}</p>{data.pending.length === 0 && <div className="pairing-empty">{zh ? '暂无待审请求' : 'No pending requests'}</div>}{data.pending.map((user, index) => <article className="pairing-card" key={`${user.platform}:${user.user_id}:${user.request_id || index}`}><div className="pairing-person"><span className="pairing-channel">{user.platform}</span><strong>{label(user)}</strong></div><div className="pairing-detail"><span>{user.user_id}</span>{typeof user.age_minutes === 'number' && <span>{user.age_minutes} {zh ? '分钟前' : 'min ago'}</span>}</div><button type="button" className="pairing-approve" disabled={busy || !user.request_id} title={!user.request_id ? (zh ? '旧请求没有可用 ID，请让用户重新发起配对' : 'Ask the user to request pairing again') : undefined} onClick={() => approve(user)}>{zh ? '批准' : 'Approve'}</button></article>)}</section>
      <section className="pairing-section"><div className="pairing-section-head"><h2>{zh ? '已批准用户' : 'Approved users'}</h2><span>{data.approved.length}</span></div><p>{zh ? '撤销后，该用户将失去对应渠道的访问权限。' : 'Revoking removes channel access for this user.'}</p>{data.approved.length === 0 && <div className="pairing-empty">{zh ? '暂无已批准用户' : 'No approved users'}</div>}{data.approved.map((user, index) => <article className="pairing-card" key={`${user.platform}:${user.user_id}:${index}`}><div className="pairing-person"><span className="pairing-channel">{user.platform}</span><strong>{label(user)}</strong></div><div className="pairing-detail"><span>{user.user_id}</span></div><button type="button" className="pairing-revoke" disabled={busy} onClick={() => revoke(user)}>{zh ? '撤销' : 'Revoke'}</button></article>)}</section>
    </div>}
  </main>
}
