import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationApprovalChoice } from '../src/adapter/notificationActions.ts'

test('approval notification actions accept desktop IDs and macOS titles only', () => {
  for (const action of ['approve', '允许一次', 'Allow once']) assert.equal(notificationApprovalChoice(action), 'once')
  for (const action of ['deny', '拒绝', 'Reject']) assert.equal(notificationApprovalChoice(action), 'deny')
  for (const action of ['tap', 'always', 'approve:unknown']) assert.equal(notificationApprovalChoice(action), null)
})
