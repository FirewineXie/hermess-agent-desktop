import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/features/personal-tasks/reviewCapability.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
const capability = await import(moduleUrl)

test('native capability values fail closed to an unknown presentation state', () => {
  assert.equal(capability.normalizeReviewCapability('ready'), 'ready')
  assert.equal(capability.normalizeReviewCapability('missing'), 'missing')
  assert.equal(capability.normalizeReviewCapability('unexpected'), 'unavailable')
  assert.equal(capability.normalizeReviewCapability(undefined), 'unavailable')
})

test('only review-lane assignment blocks a known incapable profile', () => {
  assert.equal(capability.cannotReceiveReview('review', 'missing'), true)
  assert.equal(capability.cannotReceiveReview('review', 'unavailable'), false)
  assert.equal(capability.cannotReceiveReview('ready', 'missing'), false)
})

test('capability labels distinguish ready, missing, and unknown states', () => {
  assert.equal(capability.reviewCapabilityLabel('ready'), '可自动审核')
  assert.equal(capability.reviewCapabilityLabel('missing'), '未启用审核技能')
  assert.equal(capability.reviewCapabilityLabel('unavailable'), '审核能力未知')
})

test('review implementer prefers durable review provenance over the current assignee', () => {
  assert.equal(capability.resolveReviewImplementer('builder', 'reviewer'), 'builder')
  assert.equal(capability.resolveReviewImplementer(null, 'builder'), 'builder')
  assert.equal(capability.resolveReviewImplementer('  builder  ', 'reviewer'), 'builder')
  assert.equal(capability.resolveReviewImplementer(null, null), '')
})

test('an implementer cannot be assigned to review the same task', () => {
  assert.equal(capability.isReviewSelfAssignment('builder', 'builder'), true)
  assert.equal(capability.isReviewSelfAssignment('reviewer', 'builder'), false)
  assert.equal(capability.isReviewSelfAssignment('', 'builder'), false)
})
