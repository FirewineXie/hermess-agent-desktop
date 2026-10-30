import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDocument } from 'yaml'
import { checkYamlDraft, formatYamlDraft } from '../src/features/agent-settings/yamlDraft.ts'

test('formats plugin settings while preserving values and comments', () => {
  const input = '# Plugin settings\nplugins: {enabled: [demo], entries: {demo: {settings: {retries: 3}}}}\n'
  const formatted = formatYamlDraft(input)
  assert.ok(formatted)
  assert.match(formatted, /# Plugin settings/)
  assert.match(formatted, /  entries:\n    demo:\n      settings:\n        retries: 3/)
  assert.deepEqual(parseDocument(formatted).toJS(), parseDocument(input).toJS())
})

test('rejects malformed YAML, duplicate keys and non-mapping roots', () => {
  for (const input of ['plugins: [\n', 'plugins: {}\nplugins: {}\n', '- plugins']) {
    assert.equal(checkYamlDraft(input).valid, false)
    assert.equal(formatYamlDraft(input), null)
  }
})
