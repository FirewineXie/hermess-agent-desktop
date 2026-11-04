import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionHealthAlerts } from '../src/features/session-management/sessionHealth.ts'

test('session health keeps exact gateway and platform failure details', () => {
  assert.deepEqual(sessionHealthAlerts({
    gateway_running: false,
    gateway_state: 'startup_failed',
    gateway_exit_reason: 'credential collision',
    gateway_platforms: { telegram: { state: 'fatal', error_code: 'auth_failed', error_message: 'token rejected' } },
  }), [
    { key: 'gateway', title: 'Gateway: startup_failed', detail: 'credential collision' },
    { key: 'platform:telegram', title: 'telegram: fatal', detail: 'token rejected' },
  ])
})

test('session health omits healthy and deliberately disabled entries', () => {
  assert.deepEqual(sessionHealthAlerts({
    gateway_running: true,
    gateway_state: 'running',
    gateway_platforms: { telegram: { state: 'connected' }, whatsapp: { state: 'disabled' } },
  }), [])
})
