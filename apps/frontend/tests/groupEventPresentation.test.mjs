import test from 'node:test'
import assert from 'node:assert/strict'
import { groupHistoryItems } from '../src/features/bots/groupEventPresentation.ts'

test('group history shows messages and actionable status without internal success events', () => {
  const row = (seq, kind, payload = {}) => ({ seq, kind, event_id: `event-${seq}`, actor: { kind: 'gateway', id: 'gateway' }, payload, room_id: 'room', created_at: 0 })
  const events = [
    row(1, 'message.user', { text: '你好' }),
    row(2, 'turn.started'),
    row(3, 'message.member', { text: '收到' }),
    row(4, 'turn.settled'),
    row(5, 'room.activity', { status: 'settled' }),
    row(6, 'turn.failed', { reason_code: 'provider_auth_or_access', error: 'provider rejected the request' }),
    row(7, 'room.activity', { status: 'bounded', reason_code: 'max_rounds' }),
  ]
  const result = groupHistoryItems(events, true)
  assert.deepEqual(result.map(item => item.event.seq), [1, 3, 6, 7])
  assert.equal(result[2].notice, 'Bot 回复失败：模型服务认证或访问失败')
  assert.equal(result[3].notice, '本轮讨论已达到上限')
})
