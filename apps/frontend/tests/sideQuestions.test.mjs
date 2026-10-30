import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptSideQuestion, settleSideQuestion } from '../src/features/chat/sideQuestions.ts'
import { runBtwCommand } from '../src/features/chat/btwCommand.ts'

const scope = { profile: 'default', sessionId: 'session-a' }
const completion = (text, sessionId = scope.sessionId) => ({
  kind: 'btw.complete', profile: scope.profile, session_id: sessionId,
  payload: { task_id: 'btw_1', question: '旁问内容', text },
})

test('side question completion is isolated by session and survives receipt ordering', () => {
  const completed = settleSideQuestion([], completion('旁问答案'))
  assert.equal(completed[0].status, 'complete')
  assert.deepEqual(acceptSideQuestion(completed, scope, 'btw_1', '旁问内容'), completed)
  assert.deepEqual(settleSideQuestion(completed, completion('旁问答案')), completed)
  assert.equal(settleSideQuestion(completed, completion('其它会话答案', 'session-b')).length, 2)
  const failed = settleSideQuestion(completed, completion('error: 模型不可用'))
  assert.equal(failed[0].status, 'failed')
  assert.equal(failed[0].answer, '模型不可用')
})

test('btw preserves the input on uncertain delivery and clears only an unchanged accepted draft', async () => {
  let draft = '/btw 旁问内容'
  let status = ''
  const options = {
    scope, draft, hasAttachments: false, inFlight: { current: false }, isCurrent: () => true,
    language: 'zh-CN', ask: async () => ({ status: 'unknown' }),
    setDraft: update => { draft = typeof update === 'function' ? update(draft) : update },
    setStatus: value => { status = value }, describeError: String,
  }
  assert.equal(await runBtwCommand(options), false)
  assert.equal(draft, '/btw 旁问内容')
  assert.match(status, /未确认/)
  options.ask = async () => ({ status: 'accepted', taskId: 'btw_1' })
  assert.equal(await runBtwCommand(options), true)
  assert.equal(draft, '')
  draft = '/btw 修改后的内容'
  options.draft = '/btw 旁问内容'
  assert.equal(await runBtwCommand(options), true)
  assert.equal(draft, '/btw 修改后的内容')
})
