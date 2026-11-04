import test from 'node:test'
import assert from 'node:assert/strict'
import { gatewayTopologyRows } from '../src/features/runtime/gatewayTopology.ts'

test('gateway topology shows the process owner and every served profile once', () => {
  assert.deepEqual(gatewayTopologyRows({
    profiles: [], selected: 'default', gateway_mode: 'multiplex', reason: null,
    gateways: [{ profile: 'default', served_profiles: ['default', 'writer', 'reviewer'] }],
  }), [{ owner: 'default', served: ['default', 'writer', 'reviewer'] }])
})
