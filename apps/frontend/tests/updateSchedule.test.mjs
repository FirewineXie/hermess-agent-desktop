import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUTOMATIC_UPDATE_CHECK_INTERVAL_MS,
  automaticUpdateCheckDelay,
} from '../src/features/about/updateSchedule.ts'

test('automatic update checks run immediately only when no previous check exists', () => {
  assert.equal(automaticUpdateCheckDelay(null, 1_000), 0)
  assert.equal(automaticUpdateCheckDelay(Number.NaN, 1_000), 0)
})

test('automatic update checks wait until 24 hours after the previous request', () => {
  const lastCheckAt = 1_000
  assert.equal(
    automaticUpdateCheckDelay(lastCheckAt, lastCheckAt + 60 * 60 * 1000),
    23 * 60 * 60 * 1000,
  )
  assert.equal(
    automaticUpdateCheckDelay(lastCheckAt, lastCheckAt + AUTOMATIC_UPDATE_CHECK_INTERVAL_MS),
    0,
  )
})

test('clock rollback schedules one check after a full interval', () => {
  assert.equal(
    automaticUpdateCheckDelay(2_000, 1_000),
    AUTOMATIC_UPDATE_CHECK_INTERVAL_MS,
  )
})
