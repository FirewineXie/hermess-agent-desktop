import assert from 'node:assert/strict'
import test from 'node:test'
import { elapsedLabel, nextRunOverdueMs, repeatLabel, scheduledJobState, scheduledJobStateCounts, scheduledJobStateLabel, schedulerStaleAge } from '../src/features/scheduled-tasks/scheduledTaskHealth.ts'

test('keeps the receiver cron lifecycle state instead of flattening it to enabled', () => {
  assert.equal(scheduledJobState({ enabled: false, state: 'completed' }), 'completed')
  assert.equal(scheduledJobState({ enabled: true, state: 'error' }), 'error')
  assert.equal(scheduledJobState({ enabled: false }), 'disabled')
  assert.equal(scheduledJobState({ enabled: true }), 'scheduled')
  assert.equal(scheduledJobStateLabel('completed', true), '已完成')
  assert.equal(scheduledJobStateLabel('error', false), 'Error')
  assert.equal(scheduledJobStateLabel('future-state', true), 'future-state')
  assert.deepEqual(scheduledJobStateCounts([
    { enabled: true, state: 'scheduled' },
    { enabled: false, state: 'completed' },
    { enabled: true, state: 'error' },
    { enabled: false, state: 'paused' },
    { enabled: false },
  ]), { scheduled: 1, completed: 1, error: 1, paused: 1, disabled: 1 })
})

test('marks only enabled jobs overdue after the receiver grace period', () => {
  const now = Date.parse('2026-11-04T12:00:00Z')
  assert.equal(nextRunOverdueMs({ enabled: true, state: 'scheduled', next_run_at: '2026-11-04T11:44:59Z' }, now), 901000)
  assert.equal(nextRunOverdueMs({ enabled: true, state: 'scheduled', next_run_at: '2026-11-04T11:45:01Z' }, now), null)
  assert.equal(nextRunOverdueMs({ enabled: false, next_run_at: '2026-11-01T00:00:00Z' }, now), null)
  assert.equal(nextRunOverdueMs({ state: 'completed', next_run_at: '2026-11-01T00:00:00Z' }, now), null)
})

test('reports the oldest stale heartbeat only when an enabled job can be stranded', () => {
  assert.equal(schedulerStaleAge([
    { enabled: true, state: 'scheduled', scheduler_heartbeat_age_s: 205 },
    { enabled: true, state: 'scheduled', scheduler_heartbeat_age_s: 420 },
    { enabled: false, scheduler_heartbeat_age_s: 900 },
  ]), 420)
  assert.equal(schedulerStaleAge([{ enabled: true, scheduler_heartbeat_age_s: 200 }]), null)
})

test('formats repeat progress and localized elapsed durations', () => {
  assert.equal(repeatLabel(null, true), '无限次')
  assert.equal(repeatLabel({ times: 5, completed: 2 }, false), '2/5')
  assert.equal(elapsedLabel(3599, false), '59m ago')
  assert.equal(elapsedLabel(7200, true), '2 小时前')
})
