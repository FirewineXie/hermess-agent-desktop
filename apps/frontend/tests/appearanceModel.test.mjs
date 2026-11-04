import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_APPEARANCE, parseAppearance, resolvedTheme } from '../src/features/desktop/appearanceModel.ts'

test('appearance preference rejects corrupt and unknown stored values', () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE)
  assert.deepEqual(parseAppearance('{broken'), DEFAULT_APPEARANCE)
  assert.deepEqual(parseAppearance(JSON.stringify({ theme: 'neon', font: 'remote-font' })), DEFAULT_APPEARANCE)
})

test('appearance preference preserves independently valid fields', () => {
  assert.deepEqual(parseAppearance(JSON.stringify({ theme: 'dark', font: 'remote-font' })), { theme: 'dark', font: 'system-sans' })
  assert.deepEqual(parseAppearance(JSON.stringify({ theme: 'neon', font: 'system-mono' })), { theme: 'system', font: 'system-mono' })
})

test('system theme follows the operating system while explicit choices do not', () => {
  assert.equal(resolvedTheme({ theme: 'system', font: 'system-sans' }, true), 'dark')
  assert.equal(resolvedTheme({ theme: 'system', font: 'system-sans' }, false), 'light')
  assert.equal(resolvedTheme({ theme: 'light', font: 'system-sans' }, true), 'light')
})
