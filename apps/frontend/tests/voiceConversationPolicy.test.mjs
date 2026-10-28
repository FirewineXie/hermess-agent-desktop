import test from 'node:test'
import assert from 'node:assert/strict'
import { captureDecision } from '../src/features/voice/voiceConversationPolicy.ts'

test('continuous voice waits for speech, retries an idle microphone, and transcribes after silence', () => {
  assert.equal(captureDecision(1_000, 1_000, false, 120_000, 1_250), 'continue')
  assert.equal(captureDecision(12_000, 12_000, false, 120_000, 1_250), 'retry')
  assert.equal(captureDecision(4_000, 1_200, true, 120_000, 1_250), 'continue')
  assert.equal(captureDecision(4_100, 1_300, true, 120_000, 1_250), 'transcribe')
  assert.equal(captureDecision(120_000, 0, true, 120_000, 1_250), 'transcribe')
})
