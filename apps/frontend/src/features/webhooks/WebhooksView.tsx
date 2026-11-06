import React from 'react'
import type { ProfilesSnapshot } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import './webhooks.css'

type WebhookRoute = {
  name: string; description: string; events: string[]; deliver: string; deliver_only: boolean
  prompt: string; url: string; secret_set: boolean; enabled: boolean; created_at?: string
}
type WebhooksResponse = { enabled: boolean; base_url: string; subscriptions: WebhookRoute[] }
type Created = { url: string; secret: string }
type Props = {
  connected: boolean; profile: string | null; profiles: ProfilesSnapshot | null; epoch: string | null
  onSelectProfile(name: string): Promise<unknown>; onRestart(): Promise<boolean>
}
const scope = (profile: string) => ({ kind: 'profile' as const, profile })

export default function WebhooksView({ connected, profile, profiles, epoch, onSelectProfile, onRestart }: Props) {
  const { extensions, channels } = useDesktop()
  const language = useLanguage()
  const zh = language === 'zh-CN'
  const [data, setData] = React.useState<WebhooksResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [restartNeeded, setRestartNeeded] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [created, setCreated] = React.useState<Created | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [events, setEvents] = React.useState('')
  const [deliver, setDeliver] = React.useState('log')
  const [deliverOnly, setDeliverOnly] = React.useState(false)
  const [prompt, setPrompt] = React.useState('')

  const refresh = React.useCallback(async () => {
    if (!connected || !profile) return
    setLoading(true)
    try {
      const result = await extensions.request<WebhooksResponse>(scope(profile), 'webhooks.list')
      setData(result)
      setError('')
    } catch (cause) { setError(describeError(cause, language)) }
    finally { setLoading(false) }
  }, [connected, profile, epoch, extensions, language])

  React.useEffect(() => { setData(null); setCreated(null); setCreateOpen(false); void refresh() }, [refresh])

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success); await refresh() }
    catch (cause) { setError(describeError(cause, language)) }
    finally { setBusy(false) }
  }

  const enable = () => {
    if (profile !== 'default') return
    void run(async () => {
      await channels.save(scope(profile), 'webhook', { env: { WEBHOOK_ENABLED: 'true' }, clear_env: [], enabled: true })
      setRestartNeeded(true)
      const restarted = await onRestart()
      if (!restarted) throw new Error('Webhook 已写入配置，但 Gateway 重启未完成。请在运行时页面重试。')
      setRestartNeeded(false)
    }, 'Webhook 接收器已启用')
  }

  const create = (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile || !name.trim()) return
    void run(async () => {
      const result = await extensions.request<WebhookRoute & Created>(scope(profile), 'webhooks.create', {
        name: name.trim().toLowerCase().replace(/\s+/g, '-'), description: description.trim(),
        events: events.split(',').map(value => value.trim()).filter(Boolean), deliver,
        deliver_only: deliverOnly, prompt: prompt.trim(),
      })
      setCreated({ url: result.url, secret: result.secret })
      setName(''); setDescription(''); setEvents(''); setDeliver('log'); setDeliverOnly(false); setPrompt('')
    }, '订阅已创建。请立即保存密钥，它只显示一次。')
  }

  const closeCreate = () => { setCreateOpen(false); setCreated(null) }
  const selectProfile = (next: string) => { setError(''); void onSelectProfile(next).catch(cause => setError(describeError(cause, language))) }

  return <main className="webhooks-page">
    <header className="webhooks-heading"><div><p className="webhooks-kicker">HERMESS · AUTOMATION</p><h1>{zh ? 'Webhooks' : 'Webhooks'}</h1><p>{zh ? '为外部事件建立独立订阅，决定由 Agent 处理还是直接转发。' : 'Create subscriptions for external events and choose how they are handled.'}</p></div><button type="button" className="webhooks-primary" disabled={!connected || !profile || !data?.enabled || busy} onClick={() => setCreateOpen(true)}>＋ {zh ? '新建订阅' : 'New subscription'}</button></header>
    <div className="webhooks-toolbar"><label>{zh ? 'Profile' : 'Profile'} <select value={profile || ''} disabled={!connected || busy} onChange={event => selectProfile(event.target.value)}>{(profiles?.profiles || []).map(item => <option key={item.name} value={item.name}>{item.display_name || item.name}</option>)}</select></label><button type="button" disabled={!connected || loading} onClick={() => void refresh()}>{loading ? '读取中…' : '刷新'}</button></div>
    {!connected && <div className="webhooks-empty">请先启动本机 Gateway。</div>}
    {error && <div className="webhooks-error" role="alert">{error}</div>}
    {notice && <div className="webhooks-notice" role="status">{notice}</div>}
    {connected && loading && !data && <div className="webhooks-empty">正在读取订阅…</div>}
    {connected && data && <>
      {!data.enabled && <div className="webhooks-banner"><div><strong>Webhook 接收器未启用</strong><p>{profile === 'default' ? '启用后需由桌面端重启产品自有 Gateway，才能接收外部事件。' : '共享 Gateway 的命名 Profile 复用默认 Profile 的监听器；请切到 default 启用。'}</p></div><button type="button" disabled={busy || profile !== 'default'} onClick={enable}>{busy ? '处理中…' : '启用接收器'}</button></div>}
      {restartNeeded && <div className="webhooks-banner"><div><strong>需要重启 Gateway</strong><p>配置已保存，接收器尚未确认启动。</p></div><button type="button" disabled={busy} onClick={() => void run(async () => { if (!await onRestart()) throw new Error('Gateway 重启未完成'); setRestartNeeded(false) }, 'Gateway 已重启')}>重试重启</button></div>}
      <section className="webhooks-section"><div className="webhooks-section-head"><h2>订阅</h2><span>{data.subscriptions.length} 项</span></div><p>订阅变更由 Gateway 热加载；停用的订阅会拒绝传入事件。</p>
        {!data.subscriptions.length && <div className="webhooks-empty">还没有 Webhook 订阅。</div>}
        <div className="webhooks-list">{data.subscriptions.map(route => <article className="webhooks-card" key={route.name}>
          <div className="webhooks-card-head"><div><h3>{route.name}</h3><span className={route.enabled ? 'webhooks-state enabled' : 'webhooks-state'}>{route.enabled ? '已启用' : '已停用'}</span></div><span>{route.deliver_only ? '直接转发' : route.deliver === 'log' ? 'Agent 处理' : `投递至 ${route.deliver}`}</span></div>
          {route.description && <p>{route.description}</p>}
          <div className="webhooks-url"><code>{route.url}</code><button type="button" onClick={() => void navigator.clipboard.writeText(route.url).catch(() => setError('复制失败'))}>复制 URL</button></div>
          <div className="webhooks-meta"><span>事件：{route.events.length ? route.events.join('、') : '全部'}</span><span>密钥：{route.secret_set ? '已设置' : '未设置'}</span></div>
          {route.prompt && <details><summary>处理提示词</summary><p>{route.prompt}</p></details>}
          <div className="webhooks-actions"><button type="button" disabled={busy} onClick={() => { if (!profile) return; void run(() => extensions.request(scope(profile), 'webhooks.toggle', { name: route.name, enabled: !route.enabled }), route.enabled ? '订阅已停用' : '订阅已启用') }}>{route.enabled ? '停用' : '启用'}</button><button type="button" disabled={busy} onClick={() => { if (!profile || !window.confirm(`永久删除订阅 ${route.name}？`)) return; void run(() => extensions.request(scope(profile), 'webhooks.delete', { name: route.name }), '订阅已删除') }}>删除</button></div>
        </article>)}</div>
      </section>
    </>}
    {createOpen && <div className="webhooks-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) closeCreate() }}><div className="webhooks-dialog" role="dialog" aria-modal="true" aria-label="新建 Webhook 订阅"><div className="webhooks-dialog-head"><h2>{created ? '保存订阅密钥' : '新建 Webhook 订阅'}</h2><button type="button" disabled={busy} onClick={closeCreate} aria-label="关闭">×</button></div>{created ? <div className="webhooks-dialog-body"><p>密钥只在创建时显示一次。请先复制并安全保存。</p><label>URL<input readOnly value={created.url} /></label><button type="button" onClick={() => void navigator.clipboard.writeText(created.url).catch(() => setError('复制失败'))}>复制 URL</button><label>密钥<input readOnly value={created.secret} /></label><button type="button" onClick={() => void navigator.clipboard.writeText(created.secret).catch(() => setError('复制失败'))}>复制密钥</button><button type="button" className="webhooks-primary" onClick={closeCreate}>已保存，完成</button></div> : <form className="webhooks-dialog-body" onSubmit={create}>
      <label>名称<input autoFocus required value={name} onChange={event => setName(event.target.value)} placeholder="例如 github-push" /></label><label>说明<input value={description} onChange={event => setDescription(event.target.value)} /></label><label>事件<input value={events} onChange={event => setEvents(event.target.value)} placeholder="逗号分隔，留空表示全部" /></label><label>投递方式<select value={deliver} onChange={event => { setDeliver(event.target.value); if (event.target.value === 'log') setDeliverOnly(false) }}>{[['log','Agent 处理'],['telegram','Telegram'],['discord','Discord'],['slack','Slack'],['email','邮件'],['github_comment','GitHub 评论']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="webhooks-check"><input type="checkbox" checked={deliverOnly} disabled={deliver === 'log'} onChange={event => setDeliverOnly(event.target.checked)} />只转发事件，不调用 Agent</label><label>处理提示词<textarea rows={4} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="收到事件时给 Agent 的补充指令" /></label><div className="webhooks-dialog-actions"><button type="button" onClick={closeCreate}>取消</button><button type="submit" className="webhooks-primary" disabled={busy || !name.trim()}>{busy ? '创建中…' : '创建订阅'}</button></div>
    </form>}</div></div>}
  </main>
}
