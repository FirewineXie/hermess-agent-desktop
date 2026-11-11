import assert from 'node:assert/strict'
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, preview } from '../node_modules/vite/dist/node/index.js'
import { Browser } from '../../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

// This fixture uses production components and a simulated desktop host; no Gateway or model is called.
const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = new URL('../chat-compact-check.html', import.meta.url)
const sourceFixture = new URL('../chat-compact-check.tsx', import.meta.url)
const output = new URL('../../../.build/chat-compact-cards/', import.meta.url)
let server, browser
await mkdir(output, { recursive: true })
try {
  await writeFile(fixture, String.raw`<div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import '/src/style.css'; import '/src/features/desktop/dark-theme.css';
import {DesktopProvider} from '/src/app/DesktopContext.tsx';
import GatewayRequestCard from '/src/features/chat/components/GatewayRequestCard.tsx';
import ChatConnectionCard from '/src/features/chat/components/ChatConnectionCard.tsx';
import {SubagentPanelForSession} from '/src/features/chat/components/SubagentPanel.tsx';
import BackgroundTaskContent from '/src/features/workspace-panel/BackgroundTaskContent.tsx';
import MessageList from '/src/features/chat/components/MessageList.tsx';
import {historyTimeline} from '/src/features/chat/timeline.ts';
import {translateApp} from '/src/i18n.tsx';
window.calls={approval:[],answers:[],stop:0,connection:[]};
const api={chat:{subagents:async()=>{if(location.search.includes('error'))throw new Error('预览：读取任务失败');return {subagents:location.search.includes('empty')?[]:[{subagent_id:'a',goal:'检查聊天交互与回归风险',status:'running',accepting_steer:true},{subagent_id:'b',goal:'整理界面优化建议',status:'completed'}]}},subagentTail:async()=>({available:true,text:'已完成组件检查，正在核对交互。'}),stopSubagent:async()=>{window.calls.stop++;return {found:true}}},events:{onGatewayEvent:async()=>()=>{}}};
function Demo(){const [answers,setAnswers]=React.useState({});return <DesktopProvider api={api}><main className="compact-demo chat-panel">
<header><h1>聊天中的确认与任务</h1><p>界面预览 · 模拟数据，不执行真实审批或任务</p></header>
<div className="demo-columns"><div>
<MessageList messages={[{kind:'message',role:'user',text:'帮我检查项目，并整理一下聊天界面的改进建议。'},{kind:'message',role:'assistant',text:'我会先检查项目类型，再运行检查。执行以下命令需要你的确认。'}]} assistant="" turnBusy={false} language="zh-CN" t={k=>translateApp('zh-CN',k)}/>
<GatewayRequestCard request={{id:'approve',method:'approval',params:{session_id:'preview',request_id:'approve',description:'运行项目检查，确认本次修改可以构建。',command:'pnpm --dir apps/frontend typecheck',choices:['once','session','deny']}}} answers={{}} t={k=>translateApp('zh-CN',k)} onAnswerChange={()=>{}} onSubmit={choice=>window.calls.approval.push(choice)}/>
<MessageList messages={[{kind:'message',role:'assistant',text:'关于任务信息的展示，我建议默认只显示摘要，详细内容按需展开。你可以选择下面的方式。'}]} assistant="" turnBusy={false} language="zh-CN" t={k=>translateApp('zh-CN',k)}/>
<GatewayRequestCard request={{id:'clarify',method:'clarify',params:{session_id:'preview',questions:[{qid:'style',question:'任务信息采用哪种展示方式？',choices:['紧凑摘要 (Recommended)','完整展开']},{qid:'checks',question:'需要保留哪些操作？',choices:['查看详情','停止任务'],multi_select:true}]}}} answers={answers} t={k=>translateApp('zh-CN',k)} onAnswerChange={(k,v)=>setAnswers(a=>({...a,[k]:v}))} onSubmit={(_,supplements)=>window.calls.answers.push({answers,supplements})}/>
<MessageList messages={historyTimeline([{role:'user',display_kind:'async_delegation_complete',content:'INTERNAL_TASK_NOTICE_FIXTURE: model-facing routing and log details',display_metadata:{display_text:'Subagent Task Completed: 检查界面'}},{role:'assistant',content:'子任务检查完成，审批和建议可以正常使用。'}])} assistant="" turnBusy={false} language="zh-CN" t={k=>translateApp('zh-CN',k)}/>
<SubagentPanelForSession profile="default" sessionId="preview" active={true} language="zh-CN"/>
<ChatConnectionCard snapshot={{op_id:'connect',deadline_at:Date.now()/1000+3600,targets:[{name:'demo',kind:'plugin',state:'pending',display:'示例插件',description:'确认后安装到当前 Profile。',target_profile:'default'}]}} language="zh-CN" onAction={async x=>window.calls.connection.push(x)} onDismiss={()=>{}}/>
</div><aside className="demo-background"><BackgroundTaskContent task={{taskId:'bg_preview',profile:'default',sessionId:'preview',prompt:'检查当前项目中的审批、建议、子任务和后台任务展示，汇总需要调整的布局，并逐项验证操作入口。'.repeat(4),result:'### 检查结果\n\n已完成界面检查。\n\n- 审批保留命令与操作按钮\n- 补充输入按需展开\n- 任务结果直接可见',truncated:false,status:'complete'}} taskId="bg_preview" profile="default" mediaScope={null} zh={true} language="zh-CN"/></aside></div>
</main></DesktopProvider>}
createRoot(document.getElementById('root')).render(<Demo/>);
</script><style>
html,body,#root {height:auto;min-height:100%;overflow:auto}
.compact-demo.chat-panel {padding:24px;max-width:1120px;margin:auto;display:block}
.compact-demo h1 {font-size:20px;margin:0 0 4px}.compact-demo header>p {font-size:13px;color:#697586;margin:0 0 16px}
.demo-columns {display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:20px}
.demo-columns>div {min-width:0}.demo-background {min-width:0;border-left:1px solid #e3e8ef;padding-left:8px;display:flex;max-height:460px}
@media(max-width:760px){.compact-demo.chat-panel{padding:12px}.demo-columns{grid-template-columns:minmax(0,1fr)}.demo-background{border-left:0;border-top:1px solid #e3e8ef;padding:10px 0;min-height:220px}}
:root[data-color-theme='dark'] {background:var(--dark-bg);color:var(--dark-text)}
</style>`, 'utf8')
  const html = await readFile(fixture, 'utf8')
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  await writeFile(sourceFixture, '// @ts-nocheck\n' + module, 'utf8')
  await writeFile(fixture, html.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="/chat-compact-check.tsx"></script>'), 'utf8')
  const outDir = fileURLToPath(new URL('site/', output))
  await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true, rollupOptions: { input: fileURLToPath(fixture) } } })
  server = await preview({ root, build: { outDir }, preview: { host: '127.0.0.1', port: 15442, strictPort: true } })
  browser = await Browser.launch({ width: 1280, height: 900 })
  const page = await browser.newPage()
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.goto('http://127.0.0.1:15442/chat-compact-check.html')
  async function wait(expression) {
    for (let i = 0; i < 100; i++) {
      if (await page.eval(expression)) return
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  async function click(selector) {
    const point = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  await wait(`document.querySelector('.subagent-header')?.textContent.includes('2')`)
  assert.equal(await page.eval(`document.querySelector('.chat-task-notice').open`), false)
  assert.equal(await page.eval(`document.querySelector('.chat-task-notice pre').checkVisibility()`), false)
  assert.equal(await page.eval(`Array.from(document.querySelectorAll('.message-user')).some(e=>e.textContent.includes('INTERNAL_TASK_NOTICE_FIXTURE'))`), false)
  await click('.chat-task-notice summary')
  assert.ok(await page.eval(`document.querySelector('.chat-task-notice pre').getBoundingClientRect().height>0`))
  await click('.chat-task-notice summary')
  const dimensions = await page.eval(`Object.fromEntries(['approval','clarify'].map(k=>[k,document.querySelector('.request-card-'+k).getBoundingClientRect().height]))`)
  assert.ok(dimensions.approval < 180, JSON.stringify(dimensions))
  assert.ok(dimensions.clarify < 400, JSON.stringify(dimensions))
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.request-card')).borderTopWidth`), '1px')
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.request-card')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  assert.equal(await page.eval(`document.querySelector('.request-command').textContent`), 'pnpm --dir apps/frontend typecheck')
  await click('.request-card-approval button')
  assert.deepEqual(await page.eval('window.calls.approval'), ['once'])
  assert.equal(await page.eval(`document.querySelector('.request-supplement-toggle').open`), false)
  await click('.request-choice')
  await click('.request-supplement-toggle summary')
  await click('.request-supplement-toggle textarea')
  await page.send('Input.insertText', { text: '保留完整审批命令' })
  await click('.request-supplement-toggle summary')
  await click('.request-question:nth-child(2) .request-choice')
  await click('.request-card-clarify .request-card-actions button')
  const answer = await page.eval('window.calls.answers[0]')
  assert.equal(answer.answers.style, '紧凑摘要 (Recommended)')
  assert.deepEqual(JSON.parse(answer.answers.checks), ['查看详情'])
  assert.equal(answer.supplements.style, '保留完整审批命令')
  await click('.subagent-header')
  await click('.subagent-roster button')
  await wait(`document.querySelector('.subagent-detail pre')?.textContent.includes('已完成组件检查')`)
  await page.screenshot({ path: fileURLToPath(new URL('subagent-expanded.png', output)), format: 'png', fullPage: true })
  await click('.subagent-detail > button')
  await wait(`!document.querySelector('.subagent-detail')`)
  await click('.subagent-body > button')
  assert.equal(await page.eval(`document.activeElement.className`), 'subagent-header')
  assert.equal(await page.eval('window.calls.stop'), 0)
  assert.equal(await page.eval(`document.querySelector('.panel-background-task-prompt').open`), false)
  await click('.panel-background-task-prompt summary')
  assert.ok(await page.eval(`document.querySelector('.panel-background-task-user').getBoundingClientRect().height>100`))
  await click('.panel-background-task-prompt summary')
  await click('.request-card-approval:last-child .request-card-actions button')
  assert.equal(await page.eval('window.calls.connection[0].action'), 'respond')
  for (const width of [1280, 768, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    assert.equal(await page.eval('document.documentElement.scrollWidth>innerWidth'), false, `Overflow at ${width}`)
    await page.eval('window.scrollTo(0,0)')
    await page.screenshot({ path: fileURLToPath(new URL(`light-${width}.png`, output)), format: 'png', fullPage: true })
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await page.eval(`document.documentElement.dataset.colorTheme='dark'`)
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.request-card')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  await page.screenshot({ path: fileURLToPath(new URL('dark-1280.png', output)), format: 'png', fullPage: true })
  await page.goto('http://127.0.0.1:15442/chat-compact-check.html?empty')
  await wait(`!!document.querySelector('.request-card')`)
  await wait(`!document.querySelector('.subagent-panel')`)
  await page.goto('http://127.0.0.1:15442/chat-compact-check.html?error')
  await wait(`document.querySelector('.subagent-header')?.textContent.includes('读取失败')`)
  await click('.subagent-header')
  await wait(`document.querySelector('.subagent-error')?.textContent.includes('读取任务失败')`)
  assert.deepEqual(page.consoleErrors, [])
  console.log('PASS: production cards with simulated host; approval, radio/checkbox/supplement submission, subagent close/focus/no-stop, background prompt toggle, connection action, empty tasks, three widths and dark theme.', dimensions)
  console.log(`Screenshots: ${fileURLToPath(output)}`)
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  await rm(fixture, { force: true })
  await rm(sourceFixture, { force: true })
}
