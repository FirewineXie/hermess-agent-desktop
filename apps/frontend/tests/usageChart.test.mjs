import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usageChartPoints } from '../src/features/usage/chartModel.ts'

test('usage chart preserves dates without sessions as zero while keeping three token series separate', () => {
  const points = usageChartPoints([
    { day: '2026-10-23', input_tokens: 100, output_tokens: 30, reasoning_tokens: 12, api_calls: 1 },
    { day: '2026-10-25', input_tokens: 200, output_tokens: 50, reasoning_tokens: 20, api_calls: 2 },
  ], 3, '2026-10-25')

  assert.deepEqual(points, [
    { day: '2026-10-23', input: 100, output: 30, reasoning: 12 },
    { day: '2026-10-24', input: 0, output: 0, reasoning: 0 },
    { day: '2026-10-25', input: 200, output: 50, reasoning: 20 },
  ])
})

test('usage chart includes the first partial day returned by the API', () => {
  const points = usageChartPoints([
    { day: '2026-10-22', input_tokens: 10, output_tokens: 2, reasoning_tokens: 1, api_calls: 1 },
  ], 3, '2026-10-25')

  assert.equal(points[0].day, '2026-10-22')
  assert.equal(points.at(-1).day, '2026-10-25')
})
