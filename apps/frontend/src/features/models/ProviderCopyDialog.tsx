import React from 'react'
import type { ProviderCopyPreview } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'

export default function ProviderCopyDialog({ profile, endpointId, language, onClose, onBusyChange }: { profile:string; endpointId:string; language:Language; onClose:()=>void; onBusyChange:(value:boolean)=>void }) {
  const { profiles, models } = useDesktop()
  const zh = language === 'zh-CN'
  const [targets,setTargets] = React.useState<string[]>([])
  const [selected,setSelected] = React.useState<string[]>([])
  const [previews,setPreviews] = React.useState<Record<string,ProviderCopyPreview>>({})
  const [results,setResults] = React.useState<Record<string,string>>({})
  const [busy,setBusy] = React.useState(false)
  const [error,setError] = React.useState('')
  const dialog = React.useRef<HTMLDivElement>(null)
  const origin = React.useRef(document.activeElement as HTMLElement | null)
  const generation = React.useRef(0)
  React.useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) },[busy,onBusyChange])
  React.useEffect(() => {
    let active = true
    void profiles.list().then(value => { if(active) setTargets(value.profiles.map(p=>p.name).filter(name=>name!==profile)) }).catch(cause=>{if(active)setError(describeError(cause,language))})
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const previousOverflow=document.body.style.overflow; document.body.style.overflow='hidden'
    return ()=>{ active=false; ++generation.current; document.body.style.overflow=previousOverflow; origin.current?.isConnected && origin.current.focus() }
  },[profile,profiles,language])
  const preview = async()=>{
    const request=++generation.current; setBusy(true); setError(''); setPreviews({});setResults({})
    const scope={kind:'profile' as const,profile}
    const rows=await Promise.all(selected.map(async target=>{
      try{return {target,value:await models.previewCopy(scope,endpointId,target)}}catch(cause){return {target,error:describeError(cause,language)}}
    }))
    if(request!==generation.current)return
    setPreviews(Object.fromEntries(rows.flatMap(row=>row.value?[[row.target,row.value]]:[])))
    setResults(Object.fromEntries(rows.flatMap(row=>row.error?[[row.target,row.error]]:[])))
    setBusy(false)
  }
  const apply=async()=>{
    const request=++generation.current;setBusy(true);setError('')
    for(const target of selected){
      const value=previews[target];if(!value?.eligible || results[target])continue
      try{
        const result=await models.copy({kind:'profile',profile},value)
        if(request!==generation.current)return
        setResults(previous=>({...previous,[target]:result.status==='copied'?(zh?'已同步；请在目标配置认证。':'Copied; configure credentials in the target.'):(zh?'已创建但未完整核实，请检查目标，勿重复同步。':'Created but not fully verified. Inspect the target before retrying.')}))
      }catch(cause){if(request===generation.current)setResults(previous=>({...previous,[target]:describeError(cause,language)}))}
    }
    if(request===generation.current)setBusy(false)
  }
  const canApply=selected.some(target=>previews[target]?.eligible&&!results[target])
  return <div className="provider-modal-backdrop"><div ref={dialog} className="provider-add-form provider-copy-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-copy-heading" onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onClose()}
    if(event.key==='Tab'){
      const items=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus()}
      else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus()}
    }
  }}>
    <div className="row"><h2 id="provider-copy-heading">{zh?'同步到其他 Profile':'Copy to other Profiles'}</h2><button disabled={busy} onClick={onClose}>{zh?'关闭':'Close'}</button></div>
    <p>{zh?'仅当目标不存在同 ID、名称或地址的提供商时允许同步。不复制凭据，不修改目标主模型。':'Only targets without a matching ID, name, or URL are eligible. Credentials and the target main model are unchanged.'}</p>
    <div className="provider-copy-targets">{targets.map(target=><div key={target}>
      <label><input type="checkbox" disabled={busy} checked={selected.includes(target)} onChange={e=>{++generation.current;setSelected(previous=>e.target.checked?[...previous,target]:previous.filter(name=>name!==target));setPreviews({});setResults({})}}/>{target}</label>
      {selected.includes(target)&&<p role="status">{results[target]||previews[target]?.reason}</p>}
      {previews[target]&&<small>{previews[target].name} · {previews[target].models.length} {zh?'个模型':'models'}</small>}
    </div>)}</div>
    {!targets.length&&<p>{zh?'没有可选择的其他 Profile。':'No other Profiles are available.'}</p>}
    <div className="actions"><button disabled={busy||!selected.length} onClick={()=>void preview()}>{zh?'检查目标':'Check targets'}</button><button className="primary" disabled={busy||!canApply} onClick={()=>void apply()}>{busy?(zh?'处理中…':'Working…'):(zh?'同步可创建的目标':'Copy eligible targets')}</button></div>
    {error&&<p role="alert">{error}</p>}
  </div></div>
}
