import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('programming timeline groups adjacent tools, preserves prose order and omits speaker headings', async () => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' })
  try {
    const { default: Timeline } = await server.ssrLoadModule('/src/features/programming/ProgrammingTool.tsx')
    const tool = (id, extra = {}) => ({ role: 'assistant', text: '', images: [], tool: { id, type: 'commandExecution', status: 'completed', summary: 'pwd', output: 'tool-output', detail: '', cwd: '/project', exit_code: 0, ...extra } })
    const messages = [
      { role: 'user', text: '检查项目', images: [] },
      { role: 'assistant', text: '先读取目录', images: [] },
      tool('cmd'),
      tool('file', { type: 'fileChange', summary: '', detail: '+++ demo.ts\n+new line', changes: [{ path: '/project/demo.ts', kind: 'add', added: 1, removed: 0 }] }),
      { role: 'assistant', text: '验证结果如下', images: [] },
      tool('failed', { status: 'failed', exit_code: 1 }),
    ]
    const render = (running, rows = messages) => renderToStaticMarkup(React.createElement(Timeline, { messages: rows, language: 'zh-CN', running }))
    const html = render(false)
    assert.equal((html.match(/class="programming-tool-group"/g) || []).length, 2)
    assert.ok(html.indexOf('先读取目录') < html.indexOf('编辑了文件，运行了命令'))
    assert.ok(html.indexOf('tool-output') < html.indexOf('验证结果如下'))
    assert.match(html, /已创建.*demo.ts.*\+1 −0/)
    assert.match(html, /失败或已拒绝/)
    assert.doesNotMatch(html, /<strong>你|编程助手/)
    const pending = [tool('pending', { status: 'inProgress', exit_code: null })]
    assert.match(render(true, pending), /正在运行/)
    assert.match(render(false, pending), /已中断/)
    assert.doesNotMatch(render(false, pending), /正在运行/)
    const timed = [{ role: 'user', text: '计时任务', images: [], timing: { started_at_ms: 1000, elapsed_ms: 3723000 } }, tool('skill', { type: 'skill', summary: 'imagegen' })]
    assert.match(render(false, timed), /运行耗时 · 1 小时 2 分钟 3 秒/)
    assert.match(render(false, timed), /已提交 Skill.*imagegen/)
    assert.match(render(false, [tool('read-skill', { skill_paths: ['/project/.agents/skills/review/SKILL.md'] })]), /读取 Skill 文档/)
    assert.match(render(false, [tool('image', { type: 'imageGeneration' })]), /生成图片/)
    assert.doesNotMatch(render(false, messages), /运行耗时/)
    assert.match(render(false, [{ ...timed[0], timing: { started_at_ms: 1000 } }]), /耗时未记录/)
  } finally { await server.close() }
})
