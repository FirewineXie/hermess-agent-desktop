import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptBackgroundTask, settleBackgroundTask } from '../src/features/chat/backgroundTasks.ts'
import { runBgCommand } from '../src/features/chat/bgCommand.ts'

const scope = { kind: 'session', profile: 'default', sessionId: 'session-a' }
const completion = (text, sessionId = scope.sessionId) => ({
  kind: 'background.complete', profile: scope.profile, session_id: sessionId,
  payload: { task_id: 'bg_1', text },
})

test('background task completion stays with its session and survives receipt ordering', () => {
  const completed = settleBackgroundTask([], completion('后台结果'))
  assert.equal(completed[0].status, 'complete')
  assert.equal(acceptBackgroundTask(completed, scope, 'bg_1', '任务内容')[0].prompt, '任务内容')
  assert.equal(settleBackgroundTask(completed, completion('后台结果')), completed)
  assert.equal(settleBackgroundTask(completed, completion('其它会话结果', 'session-b')).length, 2)
  const failed = settleBackgroundTask(completed, completion('error: 模型不可用'))
  assert.equal(failed[0].status, 'failed')
  assert.equal(failed[0].result, '模型不可用')
  const truncated = settleBackgroundTask([], { ...completion('长结果'), payload: { task_id: 'bg_1', text: '长结果', truncated: true } })
  assert.equal(truncated[0].truncated, true)
})

test('/bg preserves uncertain input and opens the panel only after admission', async () => {
  let draft = '/bg 任务内容'
  let status = ''
  let opened = 0
  const options = {
    scope, draft, hasAttachments: false, inFlight: { current: false }, isCurrent: () => true,
    language: 'zh-CN', start: async () => ({ status: 'unknown' }),
    setDraft: update => { draft = typeof update === 'function' ? update(draft) : update },
    setStatus: value => { status = value }, onStarted: () => { opened++ }, describeError: String,
  }
  assert.equal(await runBgCommand(options), false)
  assert.equal(draft, '/bg 任务内容')
  assert.equal(opened, 0)
  assert.match(status, /未确认/)
  options.start = async () => ({ status: 'accepted', taskId: 'bg_1' })
  assert.equal(await runBgCommand(options), true)
  assert.equal(draft, '')
  assert.equal(opened, 1)
})
