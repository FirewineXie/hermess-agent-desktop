import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProgrammingCommand as parse } from '../src/features/programming/programmingCommands.ts'

test('native chat commands preserve targets, explicit budgets and mode while rejecting malformed arguments', () => {
  assert.deepEqual(parse('/goal 完成目标').command, { type: 'goal', action: 'set', objective: '完成目标' })
  assert.deepEqual(parse('/goal --budget 50000 完成目标').command, { type: 'goal', action: 'set', objective: '完成目标', token_budget: 50000 })
  for (const action of ['get', 'pause', 'resume', 'clear']) assert.deepEqual(parse(`/goal ${action}`).command, { type: 'goal', action })
  assert.deepEqual(parse('/goal').command, { type: 'goal', action: 'get' })
  for (const budget of ['0', '-1', 'NaN', '1.5', '9007199254740992']) assert.ok(parse(`/goal --budget ${budget} 目标`).error)
  assert.ok(parse('/goal --budget').error)
  assert.ok(parse('/goal --budget 500').error)
  assert.deepEqual(parse('/plan 调查原因').command, { type: 'plan', mode: 'plan', prompt: '调查原因' })
  assert.deepEqual(parse('/plan off').command, { type: 'plan', mode: 'default' })
  assert.deepEqual(parse('/review').command, { type: 'review', target: { type: 'uncommittedChanges' } })
  assert.deepEqual(parse('/review --base release/v1').command.target, { type: 'baseBranch', branch: 'release/v1' })
  assert.deepEqual(parse('/review --commit abcd1234').command.target, { type: 'commit', sha: 'abcd1234', title: null })
  assert.deepEqual(parse('/review --custom 检查并发').command.target, { type: 'custom', instructions: '检查并发' })
  assert.ok(parse('/review --commit invalid').error)
  assert.ok(parse('/review --base').error)
  assert.ok(parse('/review --unknown main').error)
  assert.ok(parse('/compact extra').error)
  assert.deepEqual(parse('/compact').command, { type: 'compact' })
  assert.deepEqual(parse('普通消息 /goal 不执行命令'), {})
})
