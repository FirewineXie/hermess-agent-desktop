import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScheduleString, parseScheduleString } from '../src/features/scheduled-tasks/scheduleBuilderModel.ts'

test('builds every locked Dashboard schedule mode in a receiver-compatible form', () => {
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'interval', intervalValue: 30 }), 'every 30m')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'daily', timeOfDay: '09:05' }), '5 9 * * *')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'weekly', timeOfDay: '14:30', weekdays: [5, 1, 3] }), '30 14 * * 1,3,5')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'monthly', timeOfDay: '08:00', dayOfMonth: 15 }), '0 8 15 * *')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'once', onceAt: '2030-01-15T14:00' }), '2030-01-15T14:00:00')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'custom', custom: ' 0 9 * * MON-FRI ' }), '0 9 * * MON-FRI')
})

test('parses editable simple schedules and preserves advanced schedules as custom', () => {
  assert.deepEqual(parseScheduleString('every 2h'), { ...parseScheduleString(''), mode: 'interval', intervalValue: 2, intervalUnit: 'hours' })
  assert.deepEqual(parseScheduleString('30 14 * * 1,7').weekdays, [1, 0])
  assert.equal(parseScheduleString('0 9 * * 1-5').mode, 'custom')
  assert.equal(parseScheduleString('2026-02-03T14:00:00+08:00').custom, '2026-02-03T14:00:00+08:00')
  assert.equal(buildScheduleString(parseScheduleString('0 9 1,15 * *')), '0 9 1,15 * *')
})

test('rejects incomplete structured schedules before submit', () => {
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'once', onceAt: '' }), '')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'daily', timeOfDay: '25:00' }), '')
  assert.equal(buildScheduleString({ ...parseScheduleString(''), mode: 'monthly', dayOfMonth: 32 }), '')
})
