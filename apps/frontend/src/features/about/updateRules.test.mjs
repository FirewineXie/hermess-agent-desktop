import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareProductVersions, defaultUpdateChannel, selectUpdate } from './updateRules.ts'

test('RC versions order before their stable release and after older stable versions', () => {
  assert.equal(compareProductVersions('0.5.0-rc.1', '0.5.0-rc.2'), -1)
  assert.equal(compareProductVersions('0.5.0-rc.2', '0.5.0'), -1)
  assert.equal(compareProductVersions('0.6.0-rc.1', '0.5.0'), 1)
  assert.equal(compareProductVersions('0.5.0', 'v0.5.0'), 0)
  assert.equal(compareProductVersions('0.5.0-rc.01', '0.5.0'), null)
})

test('stable channel ignores RC and switching from a newer RC never downgrades', () => {
  const releases = [
    { version: '0.5.0', channel: 'stable', eligible: true },
    { version: '0.6.0-rc.1', channel: 'rc', eligible: true },
  ]
  assert.equal(defaultUpdateChannel('0.5.0-rc.1'), 'rc')
  assert.equal(defaultUpdateChannel('0.5.0'), 'stable')
  assert.equal(selectUpdate('0.5.0', 'stable', releases), null)
  assert.equal(selectUpdate('0.5.0', 'rc', releases)?.version, '0.6.0-rc.1')
  assert.equal(selectUpdate('0.6.0-rc.1', 'stable', releases), null)
})

test('RC channel accepts the matching stable release and ignores unapproved releases', () => {
  const releases = [
    { version: '0.5.0-rc.2', channel: 'rc', eligible: true },
    { version: '0.5.0', channel: 'stable', eligible: true },
    { version: '0.5.1', channel: 'stable', eligible: false },
  ]
  assert.equal(selectUpdate('0.5.0-rc.1', 'rc', releases)?.version, '0.5.0')
  assert.equal(selectUpdate('0.5.0', 'rc', releases), null)
})
