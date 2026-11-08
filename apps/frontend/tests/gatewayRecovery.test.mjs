import assert from 'node:assert/strict'
import test from 'node:test'
import { createGatewayRecovery, gatewayRecoveryBudget } from '../src/features/runtime/gatewayRecovery.ts'
import { createChatRecoveryWaiter } from '../src/features/chat/chatRecoveryWaiter.ts'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function harness(overrides = {}) {
  const events = []
  let time = 0
  const recovery = createGatewayRecovery({
    connect: async manual => { events.push(['connect', manual]); return { replay_epoch: 'replacement' } },
    restore: async info => { events.push(['restore', info.replay_epoch]) },
    started: () => events.push('started'),
    completed: () => events.push('completed'),
    failed: () => events.push('failed'),
    retired: () => events.push('retired'),
    now: () => time,
    wait: async delay => { time += delay },
    ...overrides,
  })
  return { ...recovery, events, time: () => time }
}

test('remote recovery retains its transient retry and restores before reporting connected', async () => {
  const calls = []
  const recovery = harness({ retryTransport: true, connect: async manual => {
    calls.push(manual)
    if (calls.length === 1) throw new Error('Gateway restarting')
    return { replay_epoch: 'new-instance' }
  } })
  await recovery.run()
  assert.deepEqual(calls, [false, false])
  assert.deepEqual(recovery.events, ['started', ['restore', 'new-instance'], 'completed'])
})

test('duplicate disconnect events share one in-flight operation', async () => {
  const native = deferred()
  let connections = 0
  const recovery = harness({ connect: async () => { connections += 1; return native.promise } })
  const first = recovery.run()
  assert.equal(recovery.run(), first)
  native.resolve({ replay_epoch: 'same' })
  await first
  assert.equal(connections, 1)
})

test('stop or switch cancellation settles immediately and rejects a late native result', async () => {
  const native = deferred()
  let connections = 0
  const manualCalls = []
  const recovery = harness({ connect: async manual => {
    manualCalls.push(manual)
    return ++connections === 1 ? native.promise : { replay_epoch: 'manual' }
  } })
  const old = recovery.run()
  recovery.cancel()
  await old
  await recovery.run(true)
  native.resolve({ replay_epoch: 'retired' })
  await Promise.resolve()
  assert.deepEqual(manualCalls, [false, true])
  assert.deepEqual(recovery.events, ['started', 'retired', 'started', ['restore', 'manual'], 'completed'])
})

test('local transport failure calls Rust once and immediately exposes a manual retry', async () => {
  const calls = []
  const recovery = harness({ connect: async manual => {
    calls.push(manual)
    throw new Error('Rust recovery failed')
  } })
  await recovery.run()
  assert.deepEqual(calls, [false])
  assert.equal(recovery.time(), 0)
  assert.deepEqual(recovery.events, ['started', 'retired', 'failed'])
  await recovery.run(true)
  assert.deepEqual(calls, [false, true])
  assert.equal(recovery.events.filter(event => event === 'failed').length, 2)
})

test('local recovery allows a near-60s Rust result followed by profile resolution and session restore', async () => {
  let time = 0
  let restored = false
  const recovery = harness({
    budget: () => gatewayRecoveryBudget(false),
    now: () => time,
    connect: async () => { time = 59_500; return { replay_epoch: 'restarted' } },
    restore: async (_, current) => { time += 30_000 + 8_000 + 30_000; restored = current() },
  })
  await recovery.run()
  assert.equal(restored, true)
  assert.equal(time, 127_500)
  assert.deepEqual(recovery.events, ['started', 'completed'])
  assert.equal(gatewayRecoveryBudget(true), 60_000)
})

test('same-process recovery also allows profile resolution, resume and event replay', async () => {
  let time = 0
  let restored = false
  const recovery = harness({
    budget: () => gatewayRecoveryBudget(false),
    now: () => time,
    connect: async () => { time = 4_500; return { replay_epoch: 'same-process' } },
    restore: async (_, current) => { time += 30_000 + 8_000 + 30_000 + 30_000; restored = current() },
  })
  await recovery.run()
  assert.equal(restored, true)
  assert.equal(time, 102_500)
  assert.deepEqual(recovery.events, ['started', 'completed'])
})

test('continuous remote failures stop within the 60 second retry budget', async () => {
  const recovery = harness({ retryTransport: true, connect: async () => { throw new Error('unavailable') } })
  await recovery.run()
  assert.equal(recovery.time(), 60_000)
  assert.deepEqual(recovery.events, ['started', 'retired', 'failed'])
})

test('transport retry policy reads the current mode instead of capturing the initial mode', async () => {
  let remote = true
  let connections = 0
  const recovery = harness({
    retryTransport: () => remote,
    connect: async () => { connections += 1; remote = false; throw new Error('mode changed') },
  })
  await recovery.run()
  assert.equal(connections, 1)
  assert.equal(recovery.time(), 0)
  assert.deepEqual(recovery.events, ['started', 'retired', 'failed'])
})

test('remote retry passes the manual flag only on its first connection attempt', async () => {
  const calls = []
  const recovery = harness({ retryTransport: true, connect: async manual => {
    calls.push(manual)
    if (calls.length < 3) throw new Error('warming up')
    return { replay_epoch: 'ready' }
  } })
  await recovery.run(true)
  assert.deepEqual(calls, [true, false, false])
})

test('a hung session restore reaches a deadline, settles its waiter and cannot publish late success', async () => {
  const waiter = createChatRecoveryWaiter()
  const publications = []
  const recovery = harness({
    budget: 15,
    restore: async (info, current) => {
      const ok = await waiter.wait(info.replay_epoch, 'default', current)
      if (current() && ok) publications.push('restored')
    },
    retired: () => waiter.cancel(),
  })
  await recovery.run()
  assert.equal(waiter.current, null)
  assert.deepEqual(publications, [])
  assert.deepEqual(recovery.events, ['started', ['connect', false], 'failed'])
  recovery.cancel()
  assert.equal(recovery.events.filter(event => event === 'failed').length, 1)
})

test('a failed local session restore requires manual retry without reconnecting Rust in a loop', async () => {
  const waiter = createChatRecoveryWaiter()
  let restores = 0
  const recovery = harness({ restore: async (info, current) => {
    const restored = waiter.wait(info.replay_epoch, 'default', current)
    waiter.current.complete(++restores > 1)
    if (!await restored) throw new Error('Session recovery failed')
  } })
  await recovery.run()
  assert.equal(restores, 1)
  assert.deepEqual(recovery.events, ['started', ['connect', false], 'retired', 'failed'])
  await recovery.run(true)
  assert.equal(restores, 2)
  assert.deepEqual(recovery.events.slice(-3), ['started', ['connect', true], 'completed'])
})

test('profile switch, cancellation and replacement settle every old session waiter', async () => {
  const waiter = createChatRecoveryWaiter()
  const first = waiter.wait('new', 'a', () => true)
  const stale = waiter.current
  const second = waiter.wait('new', 'b', () => true)
  assert.equal(await first, false)
  stale.complete(true)
  assert.equal(waiter.current.profile, 'b')
  waiter.cancel()
  assert.equal(await second, false)
  assert.equal(waiter.current, null)
})
