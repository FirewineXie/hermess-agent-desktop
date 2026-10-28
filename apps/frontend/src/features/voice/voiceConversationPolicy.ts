export type CaptureDecision = 'continue' | 'transcribe' | 'retry'

export function captureDecision(elapsedMs: number, quietMs: number, heardSpeech: boolean, maxMs: number, silenceMs: number): CaptureDecision {
  if (elapsedMs >= maxMs) return heardSpeech ? 'transcribe' : 'retry'
  if (!heardSpeech && elapsedMs >= 12_000) return 'retry'
  if (heardSpeech && quietMs >= silenceMs) return 'transcribe'
  return 'continue'
}
