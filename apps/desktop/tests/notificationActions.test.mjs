import assert from 'node:assert/strict'
import test from 'node:test'
import { notificationApprovalChoice } from '../src/adapter/notificationActions.ts'

test('maps registered IDs and platform titles to approval choices', () => {
  for (const value of ['approve', '允许一次', 'Allow once']) assert.equal(notificationApprovalChoice(value), 'once')
  for (const value of ['deny', '拒绝', 'Reject']) assert.equal(notificationApprovalChoice(value), 'deny')
  assert.equal(notificationApprovalChoice('tap'), null)
})
