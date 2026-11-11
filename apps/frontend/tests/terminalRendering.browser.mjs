import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from '../node_modules/vite/dist/node/index.js'
import { Browser } from '../../../.agents/skills/design-taste-frontend/scripts/lib/cdp.mjs'

// Use the desktop production build and Tauri's global inline-style hashes, rather than Vite dev CSS.
const desktop = fileURLToPath(new URL('../../desktop/', import.meta.url))
const output = fileURLToPath(new URL('../../../.build/terminal-rendering/', import.meta.url))
const fixture = join(desktop, 'terminal-rendering-check.html')
const source = join(desktop, 'terminal-rendering-check.tsx')
let server, browser
try {
  await mkdir(output, { recursive: true })
  await writeFile(fixture, '<div id="root"></div><script type="module" src="/terminal-rendering-check.tsx"></script>')
  await writeFile(source, `
import React from 'react';import {createRoot} from 'react-dom/client';
import '../frontend/src/style.css';import '../frontend/src/features/desktop/dark-theme.css';
import {DesktopProvider} from '../frontend/src/app/DesktopContext';
import HostTerminals from '../frontend/src/features/workspace-panel/HostTerminals';
const listeners=new Set();window.calls={writes:[],closed:[]};let count=0;
const scope={kind:'workspace',path:''};
function emit(id,text){for(const fn of listeners)fn({id,scope,data:btoa(text)});}
const api={runtime:{savedRemote:async()=>[]},workspacePanel:{
startTerminal:async()=>({id:'terminal-'+(++count)}),
onTerminalOutput:async fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},
activateTerminal:async(_,id)=>emit(id,'Windows shell ready '+id+'\\r\\nREADY> '),
writeTerminal:async(_,id,data)=>{window.calls.writes.push({id,data});emit(id,data)},
resizeTerminal:async()=>{},closeTerminal:async(_,id)=>window.calls.closed.push(id)}};
function Demo(){const [open,setOpen]=React.useState(true);return <DesktopProvider api={api}><button onClick={()=>setOpen(true)}>打开终端</button><HostTerminals open={open} onHide={()=>setOpen(false)}/></DesktopProvider>}
createRoot(document.getElementById('root')).render(<Demo/>);
`)
  await build({ root: desktop, logLevel: 'error', build: { outDir: output, emptyOutDir: true,
    rollupOptions: { input: { main: join(desktop, 'index.html'), terminal: fixture,
      chat: join(desktop, 'chat-window.html'), quick: join(desktop, 'quick-input.html'), computer: join(desktop, 'computer-activity.html') } } } })
  const hashes = new Set()
  for (const file of (await readdir(output)).filter(name => name.endsWith('.html'))) {
    const html = await readFile(join(output, file), 'utf8')
    for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(css).digest('base64')}'`)
    }
  }
  const config = JSON.parse(await readFile(join(desktop, 'src-tauri/tauri.conf.json'), 'utf8'))
  const policy = config.app.security.csp.replace(/style-src ([^;]+)/, (_, sources) => `style-src ${sources} ${[...hashes].join(' ')}`)
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname.slice(1)
    if (path.includes('..')) { response.writeHead(400).end(); return }
    try {
      const content = await readFile(join(output, path || 'terminal-rendering-check.html'))
      response.writeHead(200, { 'Content-Security-Policy': policy, 'Content-Type':
        ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'text/html' }).end(content)
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await Browser.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/terminal-rendering-check.html`)
  const wait = async expression => {
    const deadline = Date.now() + 6000
    while (!await page.eval(expression)) {
      assert.ok(Date.now() < deadline, `Timed out: ${expression}`)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const click = async selector => {
    const point = await page.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  await wait(`!!document.querySelector('.host-terminal-controls button')`)
  await click('.host-terminal-controls button')
  await wait(`document.querySelector('.xterm-rows')?.innerText.includes('READY>')`)
  const colors = await page.eval(`(()=>{const r=document.querySelector('.xterm-rows');return {foreground:getComputedStyle(r).color,background:getComputedStyle(document.querySelector('.panel-terminal')).backgroundColor}})()`)
  await page.screenshot({ path: join(output, 'terminal.png'), format: 'png' })
  assert.equal(colors.foreground, 'rgb(255, 255, 255)', `Terminal text must remain visible under the packaged CSP: ${JSON.stringify(colors)}`)
  await click('.xterm-helper-textarea')
  await page.send('Input.insertText', { text: 'VISIBLE_INPUT' })
  await wait(`window.calls.writes.some(row=>row.data.includes('VISIBLE_INPUT'))`)
  await click('.host-terminals header button')
  await click('#root > button')
  await wait(`document.querySelector('.xterm-rows')?.innerText.includes('VISIBLE_INPUT')`)
  await click('.host-terminal-controls button')
  await wait(`document.querySelectorAll('.xterm').length===2`)
  await click('.host-terminal-tabs > div:first-child > button:first-child')
  await wait(`!document.querySelectorAll('.host-terminal-content')[0].hidden`)
  await page.eval(`document.documentElement.dataset.colorTheme='dark'`)
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.xterm-rows')).color`), 'rgb(255, 255, 255)')
  await click('.host-terminal-tabs > div:first-child > button:last-child')
  await wait(`window.calls.closed.includes('terminal-1')`)
  console.log('PASS: packaged desktop CSP, visible shell output/input, hide/reopen, tabs, dark theme and close.', colors)
} finally {
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(fixture, { force: true })
  await rm(source, { force: true })
}
