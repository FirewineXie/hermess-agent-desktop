import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardIsoTimeAgo, dashboardTimeAgo } from '../src/features/dashboard-plugins/dashboardPluginSdkUtils.ts'

const now = Date.parse('2026-11-04T12:00:00.000Z')

test('Dashboard SDK epoch helper keeps the locked seconds-based relative-time contract', () => {
  assert.equal(dashboardTimeAgo(now / 1000 - 15, now), 'just now')
  assert.equal(dashboardTimeAgo(now / 1000 - 120, now), '2m ago')
  assert.equal(dashboardTimeAgo(now / 1000 - 7200, now), '2h ago')
  assert.equal(dashboardTimeAgo(now / 1000 - 90000, now), 'yesterday')
  assert.equal(dashboardTimeAgo(now / 1000 - 259200, now), '3d ago')
})

test('Dashboard SDK ISO helper matches locked invalid, future, and relative-time behavior', () => {
  assert.equal(dashboardIsoTimeAgo('invalid', now), 'unknown')
  assert.equal(dashboardIsoTimeAgo('2026-11-04T12:00:01.000Z', now), 'unknown')
  assert.equal(dashboardIsoTimeAgo('2026-11-04T11:30:00.000Z', now), '30m ago')
  assert.equal(dashboardIsoTimeAgo('2026-11-02T12:00:00.000Z', now), '2d ago')
})
