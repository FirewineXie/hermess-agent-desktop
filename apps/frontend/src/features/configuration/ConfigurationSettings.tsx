import React from 'react'
import type { Language } from '../../i18n'
import { agentFieldTranslation, translateAgentUi } from '../../i18n'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
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
  const {agentSettings,nativeFiles}=useDesktop()
  const zh=language==='zh-CN'
  const [formDirty,setFormDirty]=React.useState(false)
  const [consentDirty,setConsentDirty]=React.useState(false)
  const [formBusy,setFormBusy]=React.useState(false)
  const [consentBusy,setConsentBusy]=React.useState(false)
  const [fileBusy,setFileBusy]=React.useState(false)
  const [fileStatus,setFileStatus]=React.useState('')
  const [resetConfirm,setResetConfirm]=React.useState(false)
  const editor=useConfigEditor({connected,profile,page,language,onDirtyChange:setFormDirty,onBusyChange:setFormBusy})
  const busy=formBusy||consentBusy||fileBusy
  React.useEffect(()=>{onDirtyChange(formDirty||consentDirty);return()=>onDirtyChange(false)},[formDirty,consentDirty,onDirtyChange])
  React.useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false)},[busy,onBusyChange])
  const t=React.useCallback((key:string,...values:unknown[])=>translateAgentUi(language,key,...values),[language])
  if(!connected||!profile)return <p>{zh?'请先连接运行时并选择 Profile。':'Connect the runtime and select a Profile.'}</p>
  const query=editor.query.trim().toLowerCase()
  const match=([key,field]:[string,{description?:string}])=>`${key} ${field.description||''} ${agentFieldTranslation(language,key)?.label||''} ${agentFieldTranslation(language,key)?.description||''}`.toLowerCase().includes(query)
  const all=Object.entries(editor.schema?.fields||{})
  const fields=pageFields(editor.schema,page).filter(entry=>entry[0]!=='command_allowlist'&&(!query||match(entry)))
  const resetKeys=pageFields(editor.schema,page).filter(entry=>!query||match(entry)).map(([key])=>key)
  const browserField=page==='browser'?editor.schema?.fields['browser.use_real_profile']:undefined
  const browserCurrent=Boolean(getField(editor.config,'browser.use_real_profile'))
  const browserDraft=editor.drafts['browser.use_real_profile']??String(browserCurrent)
  const chooseBrowser=(useRealProfile:boolean)=>editor.setDrafts(useRealProfile===browserCurrent?{}:{'browser.use_real_profile':String(useRealProfile)})
  const links=page==='advanced-config'?all.filter(([key,field])=>fieldOwner(key)!==page||!editableField(key,field)).filter(entry=>!query||match(entry)):[]
  const definition=settingsPages.find(item=>item.id===page)
  const exportJson=async()=>{
    if(!profile||fileBusy)return
    setFileStatus('')
    try{
      const path=await nativeFiles.save('hermes-config.json')
      if(!path)return
      setFileBusy(true)
      const result=await agentSettings.exportJson({kind:'profile',profile},path,editor.config)
      setFileStatus(zh?`配置已导出（${result.bytes.toLocaleString()} 字节）。`:`Configuration exported (${result.bytes.toLocaleString()} bytes).`)
    }catch(cause){setFileStatus(describeError(cause,language))}
    finally{setFileBusy(false)}
  }
  const importJson=async()=>{
    if(!profile||fileBusy)return
    setFileStatus('')
    try{
      const selected=await nativeFiles.choose({directory:false,multiple:false,title:zh?'选择 Hermes 配置 JSON':'Choose Hermes configuration JSON'})
      if(!selected||Array.isArray(selected))return
      setFileBusy(true)
      const value=await agentSettings.importJson({kind:'profile',profile},selected)
      if(editor.replaceDocument(value,zh?'JSON 已载入为草稿；检查后点击“保存全部修改”。':'JSON loaded as a draft. Review it, then select “Save all changes”.'))setFileStatus(zh?'导入文件已读取，尚未写入运行时。':'The imported file was read but has not been written to the runtime.')
    }catch(cause){setFileStatus(describeError(cause,language))}
    finally{setFileBusy(false)}
  }
  const applyReset=()=>{
    setResetConfirm(false)
    if(editor.resetFields(resetKeys))setFileStatus(zh?`已将 ${resetKeys.length} 个字段恢复为默认值草稿，尚未保存。`:`${resetKeys.length} fields were reset in the draft and have not been saved.`)
  }
  return <section className="configuration-settings">
    <header className="row"><h2>{zh?definition?.zh:definition?.en}</h2><div className="configuration-header-actions">
      {page==='advanced-config'&&<><button disabled={busy} onClick={()=>void exportJson()}>{zh?'导出 JSON':'Export JSON'}</button><button disabled={busy} onClick={()=>void importJson()}>{zh?'导入 JSON':'Import JSON'}</button></>}
      {editor.mode==='schema'&&resetKeys.length>0&&<button disabled={busy||editor.documentDirty} onClick={()=>setResetConfirm(true)}>{query?(zh?'恢复搜索结果默认值':'Reset search results'):(zh?'恢复本页默认值':'Reset this page')}</button>}
      <button disabled={busy||consentDirty} onClick={editor.reload}>{zh?'重新读取':'Reload'}</button>
    </div></header>
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
            <fieldset disabled={busy||editor.documentDirty}>
              <legend>{zh?'浏览器控制使用哪种配置？':'Which browser profile should control use?'}</legend>
              <label className="browser-control-option"><input type="radio" name="browser-control-profile" checked={browserDraft==='false'} onChange={()=>chooseBrowser(false)}/><span><strong>{zh?'独立浏览器配置':'Separate browser profile'}</strong><small>{zh?'Hermes 按需启动隔离的浏览器，不读取默认浏览器的登录信息。是否显示窗口由浏览器可见模式配置决定。':'Hermes starts an isolated browser when needed without reading logins from your default browser. Visibility follows the headed-mode setting.'}</small></span></label>
              <label className="browser-control-option"><input type="radio" name="browser-control-profile" checked={browserDraft==='true'} onChange={()=>chooseBrowser(true)}/><span><strong>{zh?'使用默认浏览器的登录配置副本':'Copy the default browser profile'}</strong><small>{zh?'Hermes 将默认 Chromium 浏览器的登录配置复制到自己的目录，再启动独立浏览器；不会控制当前打开的浏览器窗口。仅支持 Chrome、Edge、Brave 或 Chromium。':'Hermes copies logins from the default Chromium browser into its own directory, then starts a separate browser. It does not control your open browser window. Chrome, Edge, Brave and Chromium are supported.'}</small></span></label>
            </fieldset>
            <button type="button" disabled={busy||editor.documentDirty||browserDraft===String(browserCurrent)} onClick={()=>void editor.save('browser.use_real_profile')}>{zh?'保存浏览器设置':'Save browser setting'}</button>
            <p>{zh?'此设置属于当前 Profile，保存后对新浏览器会话生效。':'This setting belongs to the selected Profile and applies to new browser sessions.'}</p>
          </>:<p>{zh?'当前运行时没有提供浏览器配置切换能力。':'The current runtime does not expose this browser setting.'}</p>}
        </section>}
        {page==='security-approvals'&&editor.schema.fields.command_allowlist&&(!query||match(['command_allowlist',editor.schema.fields.command_allowlist]))&&<AllowlistEditor text={editor.drafts.command_allowlist??fieldText(getField(editor.config,'command_allowlist')??[], 'list')} busy={busy||editor.documentDirty} editing={editor.editingKey==='command_allowlist'} language={language} onEdit={()=>editor.edit('command_allowlist')} onChange={text=>editor.setDrafts({command_allowlist:text})} onSave={()=>void editor.save('command_allowlist')} onCancel={editor.cancel}/>}
        {page!=='browser'&&fields.length>0&&<ConfigTree visible={fields} queryActive={Boolean(query)} config={editor.config} drafts={editor.drafts} editingKey={editor.editingKey} busy={busy||editor.documentDirty} language={language} t={t} expandedPaths={editor.expandedPaths} setExpandedPaths={editor.setExpandedPaths} onEdit={editor.edit} onChange={(key,value)=>editor.setDrafts(previous=>({...previous,[key]:value}))} onSave={key=>void editor.save(key)} onCancel={editor.cancel}/>}
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
    {resetConfirm&&<section className="configuration-document-confirm" role="alertdialog" aria-label={zh?'确认恢复默认值':'Confirm reset to defaults'}><h3>{query?(zh?'恢复当前搜索结果？':'Reset current search results?'):(zh?'恢复当前配置页？':'Reset this configuration page?')}</h3><p>{zh?`这会把 ${resetKeys.length} 个字段载入为默认值草稿，不会立即写入。检查后仍需点击“保存全部修改”。`:`This loads defaults for ${resetKeys.length} fields into a draft. It is not written until you select “Save all changes”.`}</p><div className="actions"><button disabled={busy} onClick={applyReset}>{zh?'载入默认值':'Load defaults'}</button><button disabled={busy} onClick={()=>setResetConfirm(false)}>{zh?'取消':'Cancel'}</button></div></section>}
    {editor.documentDirty&&editor.mode==='schema'&&<section className="configuration-document-pending" role="status"><h3>{zh?'完整配置草稿待保存':'Full configuration draft pending'}</h3><p>{zh?'导入或恢复默认值会作为一次完整配置保存；保存前普通字段编辑暂时锁定。':'Imports and default resets are saved as one full configuration update. Ordinary field editing is locked until this draft is saved or discarded.'}</p><div className="actions"><button disabled={busy} onClick={()=>void editor.saveDocument()}>{zh?'保存全部修改':'Save all changes'}</button><button disabled={busy} onClick={editor.discardDocument}>{zh?'放弃草稿':'Discard draft'}</button></div></section>}
    {fileStatus&&<p role="status">{fileStatus}</p>}
    <p role="status">{editor.status}</p>
  </section>
}
