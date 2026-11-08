import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('programming uses Profile provider templates and separate model editor', async () => {
  const server = await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'})
  try {
    const {default:Options}=await server.ssrLoadModule('/src/features/models/components/ProviderPresetOptions.tsx')
    const providers=[{slug:'openai',name:'OpenAI',api_url:'https://api.openai.com/v1'},{slug:'deepseek',name:'DeepSeek'},{slug:'custom:mine',name:'PRIVATE_CUSTOM'},{slug:'user',name:'PRIVATE_SAVED',is_user_defined:true}]
    const options=renderToStaticMarkup(React.createElement('select',null,React.createElement(Options,{providers,language:'zh-CN',t:key=>key})))
    assert.match(options,/OpenAI/); assert.match(options,/DeepSeek/); assert.match(options,/preset:volcengine-ark-coding/)
    assert.doesNotMatch(options,/PRIVATE_CUSTOM|PRIVATE_SAVED|oauth:/)
    const {default:Editor}=await server.ssrLoadModule('/src/features/programming/ProgrammingProviderEditor.tsx')
    // The editor captures focus only in the browser; SSR checks the actual rendered controls.
    const previous=globalThis.document
    globalThis.document={activeElement:null}
    try {
      const base={language:'zh-CN',providers,busy:false,error:'',onChange:()=>{},onClose:()=>{},onSave:()=>{},draft:{name:'Fixture',region:'custom',base_url:'https://fixture.invalid/v1',models:['model-one','model-two']}}
      const add=renderToStaticMarkup(React.createElement(Editor,{...base,mode:'configuration'}))
      assert.match(add,/role="dialog"/); assert.match(add,/新增模型提供商/);assert.match(add,/初始模型 ID/);assert.match(add,/DeepSeek/)
      assert.doesNotMatch(add,/国内|海外|<textarea/)
      const edit=renderToStaticMarkup(React.createElement(Editor,{...base,mode:'models',draft:{...base.draft,id:'provider-id'}}))
      assert.match(edit,/model-one/);assert.match(edit,/model-two/);assert.match(edit,/添加模型/);assert.doesNotMatch(edit,/type="password"|提供商模板/)
    } finally { if(previous===undefined)delete globalThis.document;else globalThis.document=previous }
  } finally {await server.close()}
})
