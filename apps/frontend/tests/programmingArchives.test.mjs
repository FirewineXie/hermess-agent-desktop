import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('programming archives show only archived chats and expose history and restore actions', async () => {
  const server = await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'})
  try {
    const {default:Archives} = await server.ssrLoadModule('/src/features/programming/ProgrammingArchives.tsx')
    const controller = { sessions: [
      {id:'archive',title:'ARCHIVED_CHAT',cwd:'/work/app',model:'MODEL_NAME',archived:true},
      {id:'active',title:'ACTIVE_CHAT',cwd:'/work/app',archived:false},
      {id:'legacy',title:'LEGACY_CHAT',cwd:'/work/app'},
    ],busy:false,error:'' }
    const markup = renderToStaticMarkup(React.createElement(Archives,{controller,language:'zh-CN'}))
    assert.match(markup,/ARCHIVED_CHAT/)
    assert.match(markup,/MODEL_NAME/)
    assert.match(markup,/查看记录/)
    assert.match(markup,/恢复会话/)
    assert.doesNotMatch(markup,/ACTIVE_CHAT|LEGACY_CHAT/)
    const empty = renderToStaticMarkup(React.createElement(Archives,{controller:{...controller,sessions:[],error:'READ_FAILED'},language:'en-US'}))
    assert.match(empty,/No matching archived programming chats/)
    assert.match(empty,/role="alert">READ_FAILED/)
  } finally { await server.close() }
})

test('sidebar exposes archive and delete for saved chats and a discard action for the pending draft', async () => {
  const server = await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'})
  try {
    const {default:Sessions} = await server.ssrLoadModule('/src/features/programming/ProgrammingSessions.tsx')
    const controller = {sessions:[{id:'saved',title:'SAVED',cwd:'/work/app',status:'completed'},{id:'running',title:'RUNNING',cwd:'/work/app',status:'running'}],session:null,cwd:'/work/app',projects:[],busy:false,error:'',draftVisible:true}
    const markup = renderToStaticMarkup(React.createElement(Sessions,{controller,language:'zh-CN',active:true,onOpen(){}}))
    assert.match(markup,/class="session-title">SAVED/)
    assert.match(markup,/class="sidebar-session-archive programming-session-archive"/)
    assert.match(markup,/class="sidebar-session-delete programming-session-delete"/)
    assert.match(markup,/>□<\/button>/)
    assert.match(markup,/>×<\/button>/)
    assert.match(markup,/aria-label="归档编程会话 SAVED"/)
    assert.match(markup,/aria-label="删除编程会话 SAVED"/)
    assert.match(markup,/disabled="" aria-label="归档编程会话 RUNNING"/)
    assert.match(markup,/disabled="" aria-label="删除编程会话 RUNNING"/)
    assert.match(markup,/发送第一条消息后才能归档/)
    assert.match(markup,/删除新编程会话草稿/)
    const dismissed = renderToStaticMarkup(React.createElement(Sessions,{controller:{...controller,draftVisible:false},language:'zh-CN',active:true,onOpen(){}}))
    assert.doesNotMatch(dismissed,/删除新编程会话草稿/)
  } finally { await server.close() }
})
