import test from 'node:test'
import assert from 'node:assert/strict'
import { QuickInputFlight } from '../src/features/desktop/quickFlight.ts'

test('an immediate host result settles before submit IPC returns', async () => {
  const flight = new QuickInputFlight()
  assert.equal(flight.begin('request'), true)
  await (async () => { assert.equal(flight.settle('request'), true) })()
  assert.equal(flight.waiting('request'), false)
  assert.equal(flight.settle('request'), false)
})

test('only the active request can settle and double submit is rejected', () => {
  const flight = new QuickInputFlight()
  assert.equal(flight.begin('one'), true)
  assert.equal(flight.begin('two'), false)
  assert.equal(flight.settle('two'), false)
  assert.equal(flight.waiting('one'), true)
  assert.equal(flight.settle('one'), true)
  assert.equal(flight.begin('two'), true)
})
