import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('channel authorization hides the QR during saving and failure, and isolates profiles and gateway epochs', async () => {
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { default: View } = await server.ssrLoadModule('/src/features/channels/ChannelsView.tsx')
    const { DesktopProvider } = await server.ssrLoadModule('/src/app/DesktopContext.tsx')
    const { activateWorkspaceEpoch, useProfileState, workspaceKey } = await server.ssrLoadModule('/src/app/profile-scope/ProfileWorkspace.ts')
    const api = { channels: {} }
    const key = workspaceKey('qr-test', 'default')
    activateWorkspaceEpoch('qr-test')
    function write(slot, value) {
      renderToStaticMarkup(React.createElement(() => {
        const [, set] = useProfileState(key, null, `channels:${slot}`)
        set(value)
        return null
      }))
    }
    const render = (profile = 'default', epoch = 'qr-test') => renderToStaticMarkup(React.createElement(DesktopProvider, { api },
      React.createElement(View, { connected: true, profile, epoch, onRestart: async () => true, onForceRestart: async () => true })))
    for (const platform of ['feishu', 'weixin']) {
      write('active-qr', { profile: 'default', platform, qr: { id: 'fixture', poll_interval: 5 }, image: 'data:image/png;base64,fixture', access: 'pairing' })
      write('authorized', false)
      write('status', '等待扫码…')
      assert.match(render(), /<img[^>]*data:image\/png/)
      write('authorized', true)
      write('status', '授权成功，正在保存配置…')
      const saving = render()
      assert.doesNotMatch(saving, /<img|等待扫码/)
      assert.match(saving, /授权成功，正在保存配置/)
      assert.match(saving, /无需再次扫码/)
      write('poll-error', true)
      write('status', '保存失败')
      const failed = render()
      assert.doesNotMatch(failed, /<img/)
      assert.match(failed, /保存失败/)
      assert.match(failed, /重试检查扫码结果/)
      assert.doesNotMatch(render('other-profile'), /role="dialog"/)
      write('active-qr', null)
      assert.doesNotMatch(render(), /role="dialog"/)
    }
    activateWorkspaceEpoch('replacement')
    assert.doesNotMatch(render('default', 'replacement'), /role="dialog"|授权成功/)
  } finally { await server.close() }
})
