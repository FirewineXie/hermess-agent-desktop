import assert from 'node:assert/strict'
import { writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from '../node_modules/vite/dist/node/index.js'
import { Browser } from '../../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

const fixture = new URL('../subagent-polling-check.html', import.meta.url)
let server, browser
try {
  await writeFile(fixture, `<div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import '/src/style.css';import {DesktopProvider} from '/src/app/DesktopContext.tsx';
import {SubagentPanelForSession} from '/src/features/chat/components/SubagentPanel.tsx';
window.completed=0;window.samples=[];
const api={chat:{subagents:async()=>{await new Promise(r=>setTimeout(r,140));window.completed++;return {subagents:[]}}},events:{onGatewayEvent:async()=>()=>{}}};
createRoot(document.getElementById('root')).render(React.createElement(DesktopProvider,{api},React.createElement('section',{className:'chat-panel test-shell'},React.createElement('div',{className:'chat-content'},React.createElement('p',{style:{height:300}},'普通聊天正文'),React.createElement('details',{open:true},React.createElement('summary',null,'子任务返回'),React.createElement('pre',{style:{height:140,overflow:'auto'}},'任务内部记录\\n'.repeat(80))),React.createElement('p',null,'子任务已完成，下面没有运行中的任务。'),React.createElement(SubagentPanelForSession,{profile:'default',sessionId:'polling-test',active:true,language:'zh-CN'})),React.createElement('textarea',{placeholder:'输入消息'}))));
function sample(){const e=document.querySelector('.chat-content');if(e&&window.completed>0){window.samples.push({height:e.scrollHeight,top:e.scrollTop,panel:!!document.querySelector('.subagent-panel')})}requestAnimationFrame(sample)}requestAnimationFrame(sample);
</script><style>.test-shell{height:450px;max-width:800px;margin:auto;padding:12px}.test-shell .chat-content{flex:1;width:100%}.test-shell textarea{height:90px;flex:none}</style>`, 'utf8')
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { port: 15443, strictPort: true } })
  await server.listen()
  browser = await Browser.launch()
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:15443/subagent-polling-check.html')
  const deadline = Date.now() + 9000
  while (await page.eval('window.completed<3') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 80))
  assert.ok(await page.eval('window.completed>=3'), 'Must observe three real hook polling cycles')
  const metrics = await page.eval(`({cycles:completed,heights:[...new Set(samples.map(x=>x.height))],panels:[...new Set(samples.map(x=>x.panel))]})`)
  assert.deepEqual(metrics.panels, [false], 'Empty background refresh must not render a task panel')
  assert.equal(metrics.heights.length, 1, 'Background polling must keep the chat scroll height stable')
  console.log('PASS: three real hook polling cycles, expanded task record, stable chat height and no empty panel.', metrics)
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  await rm(fixture, { force: true })
}
