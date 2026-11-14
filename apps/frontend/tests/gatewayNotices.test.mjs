import assert from 'node:assert/strict'
import test from 'node:test'
import { gatewayNotices } from '../src/features/notifications/gatewayNotices.ts'

const receive = (state, gatewayId, text) =>
  gatewayNotices(state, { type: 'receive', notice: { gatewayId, id: 'shared-key', text } })

test('viewing one gateway leaves other gateways unread and repeat frames stay read', () => {
  const both = receive(receive([], 'remote-a', 'First'), 'remote-b', 'Second')
  const read = gatewayNotices(both, { type: 'read', gatewayId: 'remote-a' })
  assert.deepEqual(read.map(item => [item.gatewayId, item.unread]), [['remote-b', true], ['remote-a', false]])
  assert.equal(receive(read, 'remote-a', 'First'), read)
  assert.equal(receive(read, 'remote-a', 'Edited')[0].unread, true)
  assert.deepEqual(receive(read, 'remote-b', null).map(item => item.gatewayId), ['remote-a'])
})
