// Development-only UI fixture. No real files, Gateway, download, or shell access.
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopApi, MediaResource, MediaScope } from '@hermess/contracts'
import { previewDesktopApi } from './mockDesktopApi'
import { DesktopProvider } from '../app/DesktopContext'
import { ChatMediaProvider } from '../features/chat/ChatMediaContext'
import MarkdownMessage from '../features/chat/components/MarkdownMessage'
import { createPreviewVideo, createPreviewWav } from './mediaFixtures'
import '../style.css'

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="#edf5ff"/><rect x="20" y="20" width="140" height="140" rx="8" fill="#1b6ffd"/><text x="177" y="90" fill="#173b6f" font-size="18">图片预览</text></svg>')
const html = '<!doctype html><html><head><style>body{padding:20px;font:16px system-ui}button{padding:8px}</style></head><body><h2>HTML 示例</h2><button onclick="this.textContent=\'交互正常\'">测试交互</button><p>MEDIA 文件卡为静态预览；显式 preview 指令沿用隔离交互。</p></body></html>'
const resources = new Map<string, { resource: MediaResource; source: string }>()
const attempts = new Map<string, number>()
const wav = createPreviewWav()
let video: Promise<Blob> | null = null
const api: DesktopApi = { ...previewDesktopApi, media: {
  async prepare(scope, source) {
    await new Promise(resolve => setTimeout(resolve, source.includes('slow') ? 1600 : 120))
    const count = (attempts.get(source) || 0) + 1
    attempts.set(source, count)
    if (source.includes('retry') && count === 1) throw new Error('PREVIEW_ONLY first read fails')
    const id = crypto.randomUUID()
    const name = source.split(/[\\/]/).at(-1) || 'fixture'
    const kind = /\.png$/.test(source) ? 'image' : /\.wav$/.test(source) ? 'audio' : /\.webm$/.test(source) ? 'video' : 'file'
    const media = kind === 'audio' ? wav : kind === 'video' ? await (video ||= createPreviewVideo()) : null
    const resource: MediaResource = { id, name, kind, mime: media?.type || (kind === 'image' ? 'image/png' : name.endsWith('.html') ? 'text/html' : 'text/plain'), local: scope.gatewayEpoch === 'local', url: media ? URL.createObjectURL(media) : kind === 'image' ? image : '', size: media?.size || 512 }
    resources.set(id, { source, resource })
    return resource
  },
  async preview(id) {
    const item = resources.get(id)
    if (!item) throw new Error('PREVIEW_ONLY released')
    return item.source.endsWith('.html') ? { kind: 'html', content: html, truncated: false } : item.source.endsWith('.zip') ? { kind: 'unsupported', content: '', truncated: false } : { kind: 'text', content: '# 预览文本\n中文与 emoji 😀\n这里只使用内存测试数据。', truncated: false }
  },
  async save() { return true }, async reveal() {}, async release(id) { const url = resources.get(id)?.resource.url; if (url?.startsWith('blob:')) URL.revokeObjectURL(url); resources.delete(id) },
} }

function MediaPreview() {
  const [remote, setRemote] = React.useState(false)
  const [connected, setConnected] = React.useState(true)
  const [streaming, setStreaming] = React.useState(false)
  const [visible, setVisible] = React.useState(true)
  const [dark, setDark] = React.useState(false)
  const [live, setLive] = React.useState(0)
  React.useEffect(() => { document.documentElement.dataset.colorTheme = dark ? 'dark' : 'light' }, [dark])
  const scope: MediaScope = { kind: 'session', profile: 'default', sessionId: 'PREVIEW_ONLY', gatewayEpoch: remote ? 'remote' : 'local' }
  const text = ['二维码已就绪，扫码页在这里 👇', String.raw`MEDIA:C:\Users\demo.config\browser-harness\tmp\p-preview\shot.png`,
    'Markdown 图片：![图片](/tmp/slow.png)', 'MEDIA:/tmp/retry.png', 'MEDIA:/tmp/report.txt', 'MEDIA:/tmp/archive.zip',
    'MEDIA:/tmp/tone.wav', 'MEDIA:/tmp/animation.webm', 'MEDIA:/tmp/static.html', '::preview{file="/tmp/interactive.html"}', '```\nMEDIA:/tmp/example.png\n```', 'MEDIA:/tmp/streaming.png'].join('\n\n')
  return <DesktopProvider api={api}><main style={{ maxWidth: 760, margin: '24px auto', padding: 20, background: dark ? '#101824' : '#fff', color: dark ? '#e7edf6' : '#263448' }}>
    <h1>PREVIEW_ONLY · 聊天媒体</h1><p>仅验证前端内存模拟；不读取真实文件，不连接 Gateway。音频为生成的 1 秒 WAV，视频为浏览器绘制的 1.5 秒 WebM；需手动播放。若浏览器不支持 WebM 录制，将明确显示加载失败，不能算视频播放通过。</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={() => setRemote(value => !value)}>{remote ? '切到本地' : '切到远程'}</button>
      <button onClick={() => setConnected(value => !value)}>{connected ? '断开会话' : '连接会话'}</button>
      <button onClick={() => setStreaming(value => !value)}>{streaming ? '结束生成' : '开始生成'}</button>
      <button onClick={() => setVisible(value => !value)}>{visible ? '卸载消息' : '加载消息'}</button>
      <button onClick={() => setDark(value => !value)}>{dark ? '浅色' : '深色'}</button>
      <button onClick={() => setLive(resources.size)}>检查资源登记</button><span>资源数：{live}</span>
    </div>
    <ChatMediaProvider scope={connected ? scope : null}>{visible && <MarkdownMessage text={text} language="zh-CN" streaming={streaming} />}</ChatMediaProvider>
  </main></DesktopProvider>
}

createRoot(document.getElementById('root')!).render(<MediaPreview />)
