import assert from 'node:assert/strict'
import { test } from 'node:test'
import { previewRawYaml, savePreviewRawYaml } from '../src/preview/rawConfig.ts'

test('preview raw YAML replaces only the selected Profile configuration', () => {
  const defaultConfig = { agent: { max_turns: 12 }, approvals: { mode: 'ask' } }
  const codingConfig = structuredClone(defaultConfig)
  const expected = previewRawYaml(codingConfig)
  savePreviewRawYaml(codingConfig, 'agent:\n  max_turns: 24\napprovals:\n  mode: manual\n', expected)
  assert.equal(codingConfig.agent.max_turns, 24)
  assert.equal(codingConfig.approvals.mode, 'manual')
  assert.equal(defaultConfig.agent.max_turns, 12)
})

test('preview raw YAML rejects stale writes and invalid roots without changing data', () => {
  const config = { agent: { max_turns: 12 } }
  const expected = previewRawYaml(config)
  assert.throws(() => savePreviewRawYaml(config, 'agent:\n  max_turns: 24\n', 'stale'), /配置已变化/)
  assert.throws(() => savePreviewRawYaml(config, '- item\n', expected), /根配置/)
  assert.throws(() => savePreviewRawYaml(config, 'agent: [\n', expected), /PREVIEW_ONLY/)
  assert.throws(() => savePreviewRawYaml(config, 'agent: {}\nagent: {}\n', expected), /PREVIEW_ONLY/)
  assert.deepEqual(config, { agent: { max_turns: 12 } })
})
