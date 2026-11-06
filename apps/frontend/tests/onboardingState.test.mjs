import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldOpenOnboarding } from '../src/features/onboarding/onboardingState.ts'

test('new installation starts the guide until it is completed or skipped', () => {
  assert.equal(shouldOpenOnboarding(true, null), true)
  assert.equal(shouldOpenOnboarding(true, 'in-progress'), true)
  assert.equal(shouldOpenOnboarding(true, 'completed'), false)
  assert.equal(shouldOpenOnboarding(true, 'skipped'), false)
})

test('existing installation does not receive a new guide but resumes an unfinished one', () => {
  assert.equal(shouldOpenOnboarding(false, null), false)
  assert.equal(shouldOpenOnboarding(false, 'in-progress'), true)
})
