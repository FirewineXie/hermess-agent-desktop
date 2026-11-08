import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const baseCssUrl = new URL('../src/style.css', import.meta.url)
const settingsCssUrl = new URL('../src/features/settings/unified-settings.css', import.meta.url)

const viewUrl = new URL('../src/features/models/ModelSettingsView.tsx', import.meta.url)

test('model providers keep vertical cards while OAuth authorization lives in the add-provider picker', async () => {
  const [baseCss, settingsCss] = await Promise.all([
    readFile(baseCssUrl, 'utf8'),
    readFile(settingsCssUrl, 'utf8'),
  ])
  const view = await readFile(viewUrl, 'utf8')
  const presets = await readFile(new URL('../src/features/models/components/ProviderPresetOptions.tsx', import.meta.url), 'utf8')

  assert.match(baseCss, /\.provider-grid \{[^}]*grid-template-columns: repeat\(2/)
  assert.match(settingsCss, /\.unified-settings \.provider-grid \{[^}]*grid-template-columns: repeat\(2/)
  assert.match(settingsCss, /@container \(max-width: 560px\) \{ \.unified-settings \.provider-grid \{ grid-template-columns: 1fr;/)
  assert.match(view, /optgroup label=\{language === 'zh-CN' \? '账户授权（推荐）'/)
  assert.match(presets, /<optgroup label=\{language === 'zh-CN' \? 'API 密钥与自定义端点'/)
  assert.ok(view.indexOf('账户授权（推荐）') < view.indexOf('<ProviderPresetOptions'))
  assert.match(view, /value=\{`oauth:\$\{provider\.id\}`\}/)
  assert.doesNotMatch(view, /<ModelOAuthSettings[^>]+\/>\s*\{!modelOptionsLoaded/)
})
