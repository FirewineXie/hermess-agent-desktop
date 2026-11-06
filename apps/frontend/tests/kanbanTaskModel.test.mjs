import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_TASK_MODEL,
  bulkStatusPatch,
  failedBulkTaskIds,
  taskModelCreateFields,
  taskModelFrom,
  taskModelPatch,
} from '../src/features/personal-tasks/kanbanTaskModel.ts'
import { taskCreateOptions } from '../src/features/personal-tasks/kanbanTaskCreate.ts'

test('create options preserve locked dashboard workspace, skills, parent and parking semantics', () => {
  assert.deepEqual(taskCreateOptions({
    assignee: '', resolvedDefaultAssignee: 'researcher', priority: '7', skills: ' blogwatcher, github-code-review ,,',
    workspaceKind: 'worktree', workspacePath: ' E:\\repo ', parent: 't_parent', goalMode: true, goalMaxTurns: '12', targetStatus: 'todo',
  }), {
    assignee: 'researcher', priority: 7, workspace_kind: 'worktree', workspace_path: 'E:\\repo',
    parents: ['t_parent'], skills: ['blogwatcher', 'github-code-review'], goal_mode: true, goal_max_turns: 12, triage: false,
  })
  assert.deepEqual(taskCreateOptions({
    assignee: '__parked__', resolvedDefaultAssignee: 'default', priority: '', skills: '',
    workspaceKind: 'scratch', workspacePath: 'ignored', parent: '', goalMode: false, goalMaxTurns: '99', targetStatus: 'triage',
  }), { priority: 0, workspace_kind: 'scratch', goal_mode: false, triage: true })
})

test('create omits inherited fields and preserves an explicit model route', () => {
  assert.deepEqual(taskModelCreateFields(EMPTY_TASK_MODEL), {})
  assert.deepEqual(taskModelCreateFields({ provider: 'openai', model: 'gpt-test', effort: 'high' }), {
    model_override: 'gpt-test', provider_override: 'openai', reasoning_effort: 'high',
  })
})

test('bulk actions keep only failed cards selected', () => {
  assert.deepEqual(failedBulkTaskIds([
    { id: 't_ok', ok: true }, { id: 't_missing', ok: false }, { id: 't_blocked', ok: false },
  ]), ['t_missing', 't_blocked'])
})

test('bulk completion preserves the locked result and summary fields', () => {
  assert.deepEqual(bulkStatusPatch('done', ' shipped and verified '), {
    status: 'done', result: 'shipped and verified', summary: 'shipped and verified',
  })
  assert.deepEqual(bulkStatusPatch('blocked', 'ignored'), { status: 'blocked' })
})

test('patch clears model and effort independently using the locked API flags', () => {
  assert.deepEqual(taskModelPatch({ provider: '', model: '', effort: 'none' }), {
    clear_model_override: true, reasoning_effort: 'none',
  })
  assert.deepEqual(taskModelPatch({ provider: 'openai', model: 'gpt-test', effort: '' }), {
    model_override: 'gpt-test', provider_override: 'openai', clear_reasoning_effort: true,
  })
})

test('detail values round-trip into the editor without treating none as inherit', () => {
  assert.deepEqual(taskModelFrom({ provider_override: 'openai', model_override: 'gpt-test', reasoning_effort: 'none' }), {
    provider: 'openai', model: 'gpt-test', effort: 'none',
  })
})
