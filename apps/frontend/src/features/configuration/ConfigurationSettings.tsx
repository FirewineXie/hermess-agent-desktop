import React from 'react'
import type { Language } from '../../i18n'
import { agentFieldTranslation, translateAgentUi } from '../../i18n'
import type { SettingsPage } from '../settings/model'
import { settingsPages } from '../settings/model'
import ConfigTree from '../agent-settings/components/ConfigTree'
import YamlEditor from '../agent-settings/components/YamlEditor'
import { fieldText,getField } from '../agent-settings/model'
import { fieldOwner,pageFields,consentOwnedField,editableField,type ConfigurationPage } from './model'
import { useConfigEditor } from './useConfigEditor'
import AllowlistEditor from './AllowlistEditor'
import PrivacyConsent from './PrivacyConsent'
import CheckpointInventory from './CheckpointInventory'
import './configuration.css'

type Props={connected:boolean;profile:string|null;page:ConfigurationPage;language:Language;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void;onNavigate:(page:SettingsPage)=>void}
export default function ConfigurationSettings({connected,profile,page,language,onDirtyChange,onBusyChange,onNavigate}:Props){
  const zh=language==='zh-CN'
  const [formDirty,setFormDirty]=React.useState(false)
  const [consentDirty,setConsentDirty]=React.useState(false)
  const [formBusy,setFormBusy]=React.useState(false)
  const [consentBusy,setConsentBusy]=React.useState(false)
  const editor=useConfigEditor({connected,profile,page,language,onDirtyChange:setFormDirty,onBusyChange:setFormBusy})
  const busy=formBusy||consentBusy
  React.useEffect(()=>{onDirtyChange(formDirty||consentDirty);return()=>onDirtyChange(false)},[formDirty,consentDirty,onDirtyChange])
  React.useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false)},[busy,onBusyChange])
  const t=React.useCallback((key:string,...values:unknown[])=>translateAgentUi(language,key,...values),[language])
  if(!connected||!profile)return <p>{zh?'请先连接运行时并选择 Profile。':'Connect the runtime and select a Profile.'}</p>
  const query=editor.query.trim().toLowerCase()
  const match=([key,field]:[string,{description?:string}])=>`${key} ${field.description||''} ${agentFieldTranslation(language,key)?.label||''} ${agentFieldTranslation(language,key)?.description||''}`.toLowerCase().includes(query)
  const all=Object.entries(editor.schema?.fields||{})
  const fields=pageFields(editor.schema,page).filter(entry=>entry[0]!=='command_allowlist'&&(!query||match(entry)))
  const browserField=page==='browser'?editor.schema?.fields['browser.use_real_profile']:undefined
  const browserCurrent=Boolean(getField(editor.config,'browser.use_real_profile'))
  const browserDraft=editor.drafts['browser.use_real_profile']??String(browserCurrent)
  const chooseBrowser=(useRealProfile:boolean)=>editor.setDrafts(useRealProfile===browserCurrent?{}:{'browser.use_real_profile':String(useRealProfile)})
  const links=page==='advanced-config'?all.filter(([key,field])=>fieldOwner(key)!==page||!editableField(key,field)).filter(entry=>!query||match(entry)):[]
  const definition=settingsPages.find(item=>item.id===page)
  return <section className="configuration-settings">
    <header className="row"><h2>{zh?definition?.zh:definition?.en}</h2><button disabled={busy||consentDirty} onClick={editor.reload}>{zh?'重新读取':'Reload'}</button></header>
    <p>{zh?'配置来自当前 Profile 的运行时 Schema。保存后读取实际值核实；部分配置需要新会话或重启运行时。':'Configuration comes from this Profile’s runtime Schema. Values are verified after saving; some changes require a new session or runtime restart.'}</p>
    {page==='advanced-config'&&<nav className="configuration-mode"><button aria-pressed={editor.mode==='schema'} disabled={busy} onClick={()=>editor.switchMode('schema')}>Schema</button><button aria-pressed={editor.mode==='yaml'} disabled={busy} onClick={()=>editor.switchMode('yaml')}>YAML</button></nav>}
    {editor.mode==='yaml'?<>
      <p>{zh?'这是完整配置原文。保存会替换整份配置，运行时可能重写格式和注释；外部修改后需要重新读取。':'This is the full configuration document. Saving replaces it; the runtime may rewrite formatting and comments. Reload after external changes.'}</p>
      <YamlEditor path={editor.raw?.path} draft={editor.yaml} dirty={editor.dirty} busy={busy} zh={zh} t={t} onChange={editor.setYaml} onSave={()=>void editor.saveYaml()}/>
    </>:<>
      {page!=='browser'&&<label>{zh?'搜索当前配置页':'Search this configuration page'}<input type="search" value={editor.query} onChange={e=>editor.setQuery(e.target.value)} placeholder={zh?'字段名或说明':'Field name or description'}/></label>}
      {!editor.schema?<p>{editor.status||(zh?'正在读取配置…':'Loading configuration…')}</p>:<>
        {page==='browser'&&<section className="browser-control-settings">
          {browserField?.type==='boolean'?<>
            <fieldset disabled={busy}>
              <legend>{zh?'浏览器控制使用哪种配置？':'Which browser profile should control use?'}</legend>
              <label className="browser-control-option"><input type="radio" name="browser-control-profile" checked={browserDraft==='false'} onChange={()=>chooseBrowser(false)}/><span><strong>{zh?'独立浏览器配置':'Separate browser profile'}</strong><small>{zh?'Hermes 按需启动隔离的浏览器，不读取默认浏览器的登录信息。是否显示窗口由浏览器可见模式配置决定。':'Hermes starts an isolated browser when needed without reading logins from your default browser. Visibility follows the headed-mode setting.'}</small></span></label>
              <label className="browser-control-option"><input type="radio" name="browser-control-profile" checked={browserDraft==='true'} onChange={()=>chooseBrowser(true)}/><span><strong>{zh?'使用默认浏览器的登录配置副本':'Copy the default browser profile'}</strong><small>{zh?'Hermes 将默认 Chromium 浏览器的登录配置复制到自己的目录，再启动独立浏览器；不会控制当前打开的浏览器窗口。仅支持 Chrome、Edge、Brave 或 Chromium。':'Hermes copies logins from the default Chromium browser into its own directory, then starts a separate browser. It does not control your open browser window. Chrome, Edge, Brave and Chromium are supported.'}</small></span></label>
            </fieldset>
            <button type="button" disabled={busy||browserDraft===String(browserCurrent)} onClick={()=>void editor.save('browser.use_real_profile')}>{zh?'保存浏览器设置':'Save browser setting'}</button>
            <p>{zh?'此设置属于当前 Profile，保存后对新浏览器会话生效。':'This setting belongs to the selected Profile and applies to new browser sessions.'}</p>
          </>:<p>{zh?'当前运行时没有提供浏览器配置切换能力。':'The current runtime does not expose this browser setting.'}</p>}
        </section>}
        {page==='security-approvals'&&editor.schema.fields.command_allowlist&&(!query||match(['command_allowlist',editor.schema.fields.command_allowlist]))&&<AllowlistEditor text={editor.drafts.command_allowlist??fieldText(getField(editor.config,'command_allowlist')??[], 'list')} busy={busy} editing={editor.editingKey==='command_allowlist'} language={language} onEdit={()=>editor.edit('command_allowlist')} onChange={text=>editor.setDrafts({command_allowlist:text})} onSave={()=>void editor.save('command_allowlist')} onCancel={editor.cancel}/>}
        {page!=='browser'&&fields.length>0&&<ConfigTree visible={fields} queryActive={Boolean(query)} config={editor.config} drafts={editor.drafts} editingKey={editor.editingKey} busy={busy} language={language} t={t} expandedPaths={editor.expandedPaths} setExpandedPaths={editor.setExpandedPaths} onEdit={editor.edit} onChange={(key,value)=>editor.setDrafts(previous=>({...previous,[key]:value}))} onSave={key=>void editor.save(key)} onCancel={editor.cancel}/>}
        {links.length>0&&<section className="configuration-links"><h3>{zh?'完整 Schema 目录 · 专用或受限字段':'Full Schema · dedicated or restricted fields'}</h3>{links.map(([key,field])=>{
          const owner=fieldOwner(key)
          const target=settingsPages.find(item=>item.id===owner)
          const navigable=owner!==page
          const reason=consentOwnedField(key)?(zh?'由共享指标同意流程管理':'Managed by the consent flow'):!editableField(key,field)?(zh?'敏感或暂不支持的字段，请使用专用入口或完整 YAML':'Sensitive or unsupported field. Use a dedicated editor or full YAML.'):(zh?'在专用页面编辑':'Edit in its dedicated page')
          return <div key={key}><code>{key}</code><small>{reason}</small>{navigable&&<button disabled={busy} onClick={()=>onNavigate(owner)}>{zh?target?.zh:target?.en} →</button>}</div>
        })}</section>}
        {page!=='browser'&&!fields.length&&!links.length&&<p>{zh?'此页没有可编辑的匹配字段。':'No matching editable fields on this page.'}</p>}
      </>}
      {page==='security-privacy'&&<PrivacyConsent profile={profile} language={language} onDirtyChange={setConsentDirty} onBusyChange={setConsentBusy}/>}
      {page==='security-checkpoints'&&<CheckpointInventory profile={profile} language={language}/>}
    </>}
    <p role="status">{editor.status}</p>
  </section>
}
