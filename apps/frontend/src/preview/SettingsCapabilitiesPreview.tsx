// Development-only interaction fixture. Never used by the desktop entry point.
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopApi, DelegationRouting, DeviceStatus } from '@hermess/contracts'
import { previewDesktopApi } from './mockDesktopApi'
import { DesktopProvider } from '../app/DesktopContext'
import { LanguageProvider } from '../i18n'
import SettingsView from '../features/settings/SettingsView'
import type { SettingsPage } from '../features/settings/model'
import DelegationSettings from '../features/models/DelegationSettings'
import DeviceSettings from '../features/desktop/DeviceSettings'
import ProviderCopyDialog from '../features/models/ProviderCopyDialog'
import QuickInputView from '../features/desktop/QuickInputView'
import ConfigurationSettings from '../features/configuration/ConfigurationSettings'
import {isConfigurationPage} from '../features/configuration/model'
import NotificationPreview from './NotificationPreview'
import '../style.css'

const configurations: Record<string,Record<string,unknown>> = {
  default: {agent:{max_turns:10},approvals:{mode:'manual'},command_allowlist:['echo hello'],security:{redact_secrets:true},checkpoints:{enabled:true},terminal:{timeout:30},tool_output:{max_bytes:2000},future:{option:'PREVIEW_ONLY'}},
  writer: {agent:{max_turns:20},approvals:{mode:'manual'},command_allowlist:[],security:{redact_secrets:true},checkpoints:{enabled:false}},
}
const consent = new Map<string,{enabled:boolean;send:boolean;decided:boolean;managed:boolean}>()
const schema = {category_order:[],fields:{'agent.max_turns':{type:'number'},'approvals.mode':{type:'select',options:['manual','smart']},command_allowlist:{type:'list'},'security.redact_secrets':{type:'boolean'},'checkpoints.enabled':{type:'boolean'},'terminal.timeout':{type:'number'},'tool_output.max_bytes':{type:'number'},'future.option':{type:'string'},'telemetry.shared_metrics.enabled':{type:'boolean'},'memory.provider':{type:'string'}}}


let routing: DelegationRouting = { configured:'model_map',blocked_reason:null,backends:['default','model_map','profile_routes'].map(name=>({name,available:true})),model_map:{default:'research',options:[{name:'research',description:'复杂资料研究',provider:'preview',model:'preview-model',has_api_key:true}]},profile_routes:{profiles:[],default:null},profiles:['default','writer'] }
let device:DeviceStatus={preferences:{keepAwake:false,f12Devtools:false,quickEnabled:false,shortcut:'CommandOrControl+Shift+Space'},registered:false,awake:false,f12Supported:true,error:null}
let copied=false
const api:DesktopApi={...previewDesktopApi,
  profiles:{...previewDesktopApi.profiles,async list(){return {profiles:[{name:'default',is_default:true},{name:'writer',is_default:false}],selected:'default',gateway_mode:'single',gateways:[],reason:null}}},
  delegation:{async read(){return structuredClone(routing)},async save(_scope,draft){routing=structuredClone(draft);routing.model_map.options=routing.model_map.options.map(({credential,original_name,...row})=>({...row,has_api_key:credential?.action==='clear'?false:credential?.action==='replace'?true:row.has_api_key}));return {routing:structuredClone(routing),activated:true}}},
  device:{...previewDesktopApi.device,async status(){return structuredClone(device)},async save(preferences){if(preferences.shortcut==='taken')throw new Error('PREVIEW_ONLY: 快捷键已占用');device={...device,preferences,registered:preferences.quickEnabled,awake:preferences.keepAwake};return structuredClone(device)}},
  agentSettings:{...previewDesktopApi.agentSettings,
    async schema(){return structuredClone(schema)},
    async config(scope){return structuredClone(configurations[scope.profile])},
    async saveField(scope,key,value){const parts=key.split('.');let target=configurations[scope.profile];for(const part of parts.slice(0,-1)){target[part]??={};target=target[part] as Record<string,unknown>}target[parts.at(-1)!]=structuredClone(value)},
    async raw(scope){return {path:'PREVIEW_ONLY/'+scope.profile+'/config.yaml',yaml:'agent:\n  max_turns: '+(configurations[scope.profile].agent as {max_turns:number}).max_turns+'\n'}},
    async saveRaw(){throw new Error('PREVIEW_ONLY: YAML 必须由桌面宿主校验并保存。')},
  },
  security:{
    async consent(scope){return structuredClone(consent.get(scope.profile)||{enabled:false,send:false,decided:false,managed:false})},
    async saveConsent(scope,enabled,send){const value={enabled,send:enabled&&send,decided:true,managed:false};consent.set(scope.profile,value);return structuredClone(value)},
    async checkpoints(scope){return scope.profile==='default'?{sessions:[],total_bytes:0}:{sessions:[{session:'PREVIEW_ONLY-session',files:3,bytes:2048}],total_bytes:2048}},
  },
  models:{...previewDesktopApi.models,async previewCopy(scope,endpointId,target){return {source:scope.profile,endpointId,target,digest:'PREVIEW_ONLY',eligible:!copied,reason:copied?'PREVIEW_ONLY: 目标已有此提供商':'PREVIEW_ONLY: 可以创建，不复制凭据',name:'示例提供商',models:['preview-model']}},async copy(){copied=true;return {status:'copied',endpointId:'preview-copy'}}},
}
function Preview(){
  const [profile,setProfile]=React.useState('default')
  const [page,setPage]=React.useState<SettingsPage>('delegation')
  const [copyOpen,setCopyOpen]=React.useState(false)
  const [dirty,setDirty]=React.useState(false)
  const [busy,setBusy]=React.useState(false)
  if(new URLSearchParams(location.search).has('notifications'))return <NotificationPreview baseApi={api}/>
  if(new URLSearchParams(location.search).has('quick'))return <QuickInputView api={{async target(){return {profile:'PREVIEW_ONLY',sessionId:'preview-session',epoch:'preview',busy:false}},async submit(){throw new Error('PREVIEW_ONLY')},async onResult(){return ()=>{}},async hide(){}}}/>
  return <><div role="status" style={{padding:'8px 20px',background:'#fff4cf'}}>PREVIEW_ONLY · 内存模拟，不连接真实运行时或系统能力 <button onClick={()=>setCopyOpen(true)}>预览提供商同步</button></div><SettingsView language="zh-CN" page={page} connected profile={profile} profiles={[{name:'default'},{name:'writer'}]} profileBusy={busy} onSelectProfile={async name=>{if(name===profile)return true;if(busy||dirty&&!confirm('放弃草稿？'))return false;setDirty(false);setProfile(name);return true}} onNavigate={next=>{if(next===page)return true;if(busy||dirty&&!confirm('放弃草稿？'))return false;setDirty(false);setPage(next);return true}} onExit={()=>{}}>
    {isConfigurationPage(page)?<ConfigurationSettings key={profile+':'+page} connected profile={profile} page={page} language="zh-CN" onDirtyChange={setDirty} onBusyChange={setBusy} onNavigate={next=>{if(!busy&&(!dirty||confirm('放弃草稿？'))){setDirty(false);setPage(next)}}}/>:page==='delegation'?<DelegationSettings connected profile="default" language="zh-CN" providers={[{slug:'preview',name:'预览提供商',models:['preview-model']}]} onDirtyChange={setDirty} onBusyChange={setBusy}/>:page==='device'||page==='quick-input'?<DeviceSettings page={page} language="zh-CN"/>:<p>PREVIEW_ONLY · 请选择委派路由或桌面分类。</p>}
    {copyOpen&&<ProviderCopyDialog profile="default" endpointId="preview" language="zh-CN" onClose={()=>setCopyOpen(false)} onBusyChange={setBusy}/>}
  </SettingsView></>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><DesktopProvider api={api}><LanguageProvider><Preview/></LanguageProvider></DesktopProvider></React.StrictMode>)
