import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('goal strip and footer distinguish native live execution, paused goals and disconnected snapshots; menu exposes command names', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { ProgrammingGoal: Goal, ProgrammingSessionIndicators: Indicators } = await server.ssrLoadModule('/src/features/programming/ProgrammingSessionCommands.tsx')
    const { default: Option } = await server.ssrLoadModule('/src/features/programming/ProgrammingInputOption.tsx')
    const goal = { objective: '修复聊天并完成验证', status: 'active', tokensUsed: 13, tokenBudget: 500, timeUsedSeconds: 63 }
    const render = (component, status, context) => renderToStaticMarkup(React.createElement(component, { language: 'zh-CN', controller: { session: { id: 's', status, context }, busy: false } }))
    const live = render(Goal, 'running', { goal, active_command: 'goal' })
    assert.match(live, /执行中的目标/)
    assert.match(live, /修复聊天并完成验证/)
    assert.match(live, /1m 3s/)
    assert.match(live, /aria-label="编辑目标"/)
    assert.doesNotMatch(live, /class="programming-goal-details"/)
    assert.match(render(Indicators, 'running', { mode: 'plan' }), /\/plan 已启用/)
    assert.match(render(Indicators, 'running', { goal, active_command: 'goal' }), /\/goal 执行中/)
    assert.match(render(Indicators, 'completed', { goal: { ...goal, status: 'paused' } }), /\/goal 已暂停/)
    const stale = render(Indicators, 'stopped', { goal, active_command: 'goal' })
    assert.match(stale, /状态待确认/)
    assert.doesNotMatch(stale, /\/goal 执行中/)
    assert.match(render(Indicators, 'running', { active_command: 'review' }), /\/review 审查中/)
    assert.match(render(Indicators, 'running', { active_command: 'compact' }), /\/compact 压缩中/)
    assert.doesNotMatch(render(Indicators, 'completed', { active_command: 'review' }), /审查中/)
    const option = renderToStaticMarkup(React.createElement(Option, { row: { command: '/plan', label: '计划模式', description: '先分析', id: 'plan' }, index: 0, selected: true, onChoose() {} }))
    assert.ok(option.indexOf('>/plan<') < option.indexOf('>计划模式<'))
  } finally { await server.close() }
})
