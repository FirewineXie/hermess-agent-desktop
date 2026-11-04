import React from 'react'
import type { AgentConfigSchema, AgentRawConfig } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import { getField, fieldText } from '../agent-settings/model'
import { configValuesEqual } from '../agent-settings/memoryContextModel'
import { parseField, type ConfigurationPage } from './model'
import { isConfigDocument, resetConfigFields } from './configDocumentModel'

type Options = { connected: boolean; profile: string | null; page: ConfigurationPage; language: Language; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }
export function useConfigEditor({ connected,profile,page,language,onDirtyChange,onBusyChange }: Options) {
  const { agentSettings } = useDesktop()
  const [schema,setSchema] = React.useState<AgentConfigSchema | null>(null)
  const [config,setConfig] = React.useState<Record<string,unknown>>({})
  const [savedConfig,setSavedConfig] = React.useState<Record<string,unknown>>({})
  const [defaults,setDefaults] = React.useState<Record<string,unknown>>({})
  const [drafts,setDrafts] = React.useState<Record<string,string>>({})
  const [editingKey,setEditingKey] = React.useState<string | null>(null)
  const [expandedPaths,setExpandedPaths] = React.useState<Set<string>>(new Set())
  const [query,setQuery] = React.useState('')
  const [mode,setMode] = React.useState<'schema'|'yaml'>('schema')
  const [raw,setRaw] = React.useState<AgentRawConfig | null>(null)
  const [yaml,setYaml] = React.useState('')
  const [busy,setBusy] = React.useState(false)
  const [status,setStatus] = React.useState('')
  const request = React.useRef(0)
  const inFlight = React.useRef(false)
  const scope = profile ? {kind:'profile' as const,profile} : null
  const documentDirty = !configValuesEqual(config,savedConfig)
  const dirty = documentDirty || Object.entries(drafts).some(([key,value]) => value !== fieldText(getField(config,key),schema?.fields[key]?.type || 'string')) || raw !== null && yaml !== raw.yaml
  React.useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) },[dirty,onDirtyChange])
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) },[busy,onBusyChange])
  const message = (error: unknown) => error instanceof Error ? error.message : describeError(error,language)
  const canDiscard = () => !dirty || window.confirm(language === 'zh-CN' ? '放弃未保存的配置修改？' : 'Discard unsaved configuration changes?')
  const load = async (nextMode = mode) => {
    if (!connected || !scope || inFlight.current) return
    const current = ++request.current
    inFlight.current = true; setBusy(true); setStatus('')
    try {
      const [nextSchema,nextConfig,nextDefaults,nextRaw] = await Promise.all([agentSettings.schema(scope),agentSettings.config(scope),agentSettings.defaults(scope),nextMode === 'yaml' ? agentSettings.raw(scope) : Promise.resolve(null)])
      if (current !== request.current) return
      setSchema(nextSchema);setConfig(nextConfig);setSavedConfig(nextConfig);setDefaults(nextDefaults);setRaw(nextRaw);setYaml(nextRaw?.yaml || '');setDrafts({});setEditingKey(null);setMode(nextMode)
    } catch (cause) { if (current === request.current) setStatus(message(cause)) }
    finally { if (current === request.current) { inFlight.current=false;setBusy(false) } }
  }
  React.useEffect(() => {
    setSchema(null);setConfig({});setSavedConfig({});setDefaults({});setDrafts({});setRaw(null);setYaml('');setMode('schema');inFlight.current=false
    void load('schema')
    return () => { ++request.current }
  },[connected,profile,page])
  const reload = () => { if (!inFlight.current && canDiscard()) void load() }
  const switchMode = (next:'schema'|'yaml') => { if (next!==mode && !inFlight.current && canDiscard()) void load(next) }
  const edit = (key:string) => { if (!inFlight.current && canDiscard()) {setDrafts({});setEditingKey(key)} }
  const cancel = () => { if (!inFlight.current && canDiscard()) {setDrafts({});setEditingKey(null)} }
  const save = async (key:string) => {
    const field = schema?.fields[key]
    if (!scope || !field || drafts[key] === undefined || inFlight.current || documentDirty) return
    let value:unknown
    try { value=parseField(drafts[key],field) } catch(cause) {setStatus(message(cause));return}
    const current=++request.current
    inFlight.current=true;setBusy(true);setStatus('')
    try {
      await agentSettings.saveField(scope,key,value)
      const [nextConfig,nextSchema]=await Promise.all([agentSettings.config(scope),agentSettings.schema(scope)])
      if(current!==request.current)return
      if(!configValuesEqual(getField(nextConfig,key),value))throw new Error('已提交，但回读值不一致。请重新读取检查，勿重复提交。')
      setConfig(nextConfig);setSavedConfig(nextConfig);setSchema(nextSchema);setDrafts({});setEditingKey(null);setStatus(language==='zh-CN'?'已保存并核实；部分配置在新会话或重启运行时后生效。':'Saved and verified. Some settings apply to new sessions or after a runtime restart.')
    }catch(cause){if(current===request.current)setStatus(message(cause))}
    finally{if(current===request.current){inFlight.current=false;setBusy(false)}}
  }
  const saveYaml=async()=>{
    if(!scope||!raw||!dirty||inFlight.current)return
    const current=++request.current
    inFlight.current=true;setBusy(true);setStatus('')
    try{
      const result=await agentSettings.saveRaw(scope,yaml,raw.yaml)
      if(current!==request.current)return
      if(!result.verified)throw new Error('完整配置已提交但未能核实，请检查运行时配置。草稿已保留。')
      setRaw(result.raw);setYaml(result.raw.yaml);setStatus(language==='zh-CN'?'完整配置已保存并核实；YAML 格式和注释可能由运行时重写。':'Full configuration saved and verified. The runtime may rewrite YAML formatting and comments.')
    }catch(cause){if(current===request.current)setStatus(message(cause))}
    finally{if(current===request.current){inFlight.current=false;setBusy(false)}}
  }
  const replaceDocument=(value:unknown,notice:string)=>{
    if(!isConfigDocument(value))throw new Error(language==='zh-CN'?'配置 JSON 根节点必须是对象。':'The config JSON root must be an object.')
    if(!canDiscard())return false
    setConfig(value);setDrafts({});setEditingKey(null);setStatus(notice);return true
  }
  const resetFields=(keys:string[])=>{
    if(!keys.length||!canDiscard())return false
    setConfig(current=>resetConfigFields(current,defaults,keys));setDrafts({});setEditingKey(null)
    setStatus(language==='zh-CN'?'已载入默认值；检查后点击“保存全部修改”。':'Defaults loaded. Review them, then select “Save all changes”.')
    return true
  }
  const discardDocument=()=>{setConfig(savedConfig);setDrafts({});setEditingKey(null);setStatus('')}
  const saveDocument=async()=>{
    if(!scope||!documentDirty||inFlight.current)return
    const current=++request.current
    inFlight.current=true;setBusy(true);setStatus('')
    try{
      const result=await agentSettings.saveConfig(scope,config)
      if(current!==request.current)return
      if(!result.verified)throw new Error(language==='zh-CN'?'完整配置已提交但回读不一致；请重新读取核对，不要重复保存。':'The full config was submitted but readback differs. Reload to inspect it; do not save again yet.')
      setConfig(result.config);setSavedConfig(result.config);setDrafts({});setEditingKey(null)
      setStatus(language==='zh-CN'?'完整配置已保存并核实。部分配置需要新会话或重启运行时。':'Full configuration saved and verified. Some changes require a new session or runtime restart.')
    }catch(cause){if(current===request.current)setStatus(message(cause))}
    finally{if(current===request.current){inFlight.current=false;setBusy(false)}}
  }
  return {schema,config,defaults,drafts,setDrafts,editingKey,expandedPaths,setExpandedPaths,query,setQuery,mode,raw,yaml,setYaml,busy,status,dirty,documentDirty,load,reload,switchMode,edit,cancel,save,saveYaml,replaceDocument,resetFields,discardDocument,saveDocument}
}
