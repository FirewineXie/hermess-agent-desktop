import assert from 'node:assert/strict'
import test from 'node:test'
import { argumentTrigger, argumentOptions, argumentAllowed } from '../src/features/chat/commandArguments.ts'
const catalog = { commands: { '/skills': { desktop_subcommands: ['pending', 'approve', 'reject', 'diff', 'approval'] } }, sub: { '/skills': ['install'], '/reasoning': ['low', 'high'], '/approvals': ['off', 'status'] } }
test('argument completion replaces only the first argument and preserves later text', () => {
  const draft = '/skills ap item-123'
  const trigger = argumentTrigger(draft, 10)
  assert.equal(trigger.command, '/skills')
  assert.equal(draft.slice(0, trigger.start) + 'approve ' + draft.slice(trigger.end).trimStart(), '/skills approve item-123')
  assert.deepEqual(argumentOptions(catalog, '/skills'), ['pending', 'approve', 'reject', 'diff', 'approval'])
  assert.deepEqual(argumentOptions(catalog, '/reasoning'), ['low', 'high'])
})
test('text arguments are preserved, restricted subcommands reject before submission', () => {
  assert.equal(argumentAllowed(catalog, '/title', '新的中文标题'), true)
  assert.equal(argumentAllowed(catalog, '/plan', '第一行\n第二行'), true)
  assert.equal(argumentAllowed(catalog, '/skills', 'install example'), false)
  assert.equal(argumentAllowed(catalog, '/skills', 'approve example'), true)
  assert.equal(argumentAllowed(catalog, '/approvals', 'OFF'), false)
  assert.equal(argumentTrigger('请使用 @skill 正文', 14), null)
  assert.deepEqual(argumentOptions(catalog, '/approvals'), ['status'])
  assert.deepEqual(argumentOptions(catalog, '/retry'), [])
  assert.equal(argumentAllowed(catalog, '/retry', ''), true)
  assert.equal(argumentAllowed(catalog, '/retry', '2'), false)
  assert.equal(argumentAllowed(catalog, '/compress', '--preview'), true)
  assert.equal(argumentAllowed(catalog, '/compress', 'here 2 --preview'), true)
  assert.equal(argumentAllowed(catalog, '/compress', 'here 2'), true)
})

test('desktop navigation does not suggest CLI-only mutations and mid-token completion consumes the suffix', () => {
  assert.deepEqual(argumentOptions({ ...catalog, sub: { '/tools': ['enable', 'disable'] } }, '/tools'), [])
  const trigger = argumentTrigger('/skills appr item', 10)
  assert.equal(trigger.end, 12)
})
