import assert from 'node:assert/strict'
import test from 'node:test'
import { MCP_OAUTH_MAX_POLL_FAILURES, isMcpOAuthTerminal, mcpOAuthPollDecision, shouldCancelMcpOAuthOnCleanup } from '../src/features/profiles/mcpOAuthModel.ts'

test('MCP OAuth recognizes every supported terminal state', () => {
  for (const status of ['approved', 'error', 'expired', 'cancelled']) {
    assert.equal(isMcpOAuthTerminal(status), true)
  }
  assert.equal(isMcpOAuthTerminal('authorization_required'), false)
})

test('MCP OAuth stops after three consecutive polling failures', () => {
  let failures = 0
  for (let attempt = 1; attempt <= MCP_OAUTH_MAX_POLL_FAILURES; attempt += 1) {
    const decision = mcpOAuthPollDecision(failures)
    failures = decision.failures
    assert.equal(decision.terminal, attempt === MCP_OAUTH_MAX_POLL_FAILURES)
  }
})

test('a successful MCP OAuth poll resets transient failures', () => {
  assert.deepEqual(mcpOAuthPollDecision(2, {
    flow_id: 'flow-1',
    status: 'authorization_required',
  }), { failures: 0, terminal: false })
  assert.deepEqual(mcpOAuthPollDecision(2, {
    flow_id: 'flow-1',
    status: 'approved',
  }), { failures: 0, terminal: true })
})

test('only an abandoned pending MCP OAuth flow needs receiver cancellation', () => {
  const pending = { flow_id: 'flow-1', status: 'authorization_required' }
  assert.equal(shouldCancelMcpOAuthOnCleanup(pending, false), true)
  assert.equal(shouldCancelMcpOAuthOnCleanup(pending, true), false)
  assert.equal(shouldCancelMcpOAuthOnCleanup({ ...pending, status: 'approved' }, false), false)
  assert.equal(shouldCancelMcpOAuthOnCleanup({ ...pending, status: 'error' }, false), false)
  assert.equal(shouldCancelMcpOAuthOnCleanup(null, false), false)
})
