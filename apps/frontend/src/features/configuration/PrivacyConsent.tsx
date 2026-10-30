import React from 'react'
import type { SharedMetricsConsent } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'

export default function PrivacyConsent({profile,language,onDirtyChange,onBusyChange}:{profile:string;language:Language;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void}) {
  const {security}=useDesktop()
  const zh=language==='zh-CN'
  const [saved,setSaved]=React.useState<SharedMetricsConsent|null>(null)
  const [draft,setDraft]=React.useState({enabled:false,send:false})
  const [busy,setBusy]=React.useState(false)
  const [error,setError]=React.useState('')
  const generation=React.useRef(0)
  const inFlight=React.useRef(false)
  const dirty=Boolean(saved&&(saved.enabled!==draft.enabled||saved.send!==draft.send))
  React.useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false)},[dirty,onDirtyChange])
  React.useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false)},[busy,onBusyChange])
  const read=async()=>{
    if(inFlight.current)return
    const current=++generation.current;inFlight.current=true;setBusy(true);setError('')
    try{const value=await security.consent({kind:'profile',profile});if(current===generation.current){setSaved(value);setDraft({enabled:value.enabled,send:value.send})}}
    catch(cause){if(current===generation.current)setError(describeError(cause,language))}
    finally{if(current===generation.current){inFlight.current=false;setBusy(false)}}
  }
  React.useEffect(()=>{
    // StrictMode runs setup again after cleanup; the invalidated read must not
    // keep the replacement request blocked by its in-flight flag.
    inFlight.current=false
    setSaved(null)
    void read()
    return()=>{++generation.current}
  },[profile])
  const save=async()=>{
    if(inFlight.current||!saved||saved.managed||!dirty&&saved.decided)return
    const current=++generation.current;inFlight.current=true;setBusy(true);setError('')
    try{
      const value=await security.saveConsent({kind:'profile',profile},draft.enabled,draft.enabled&&draft.send)
      if(current!==generation.current)return
      if(value.enabled!==draft.enabled||value.send!==(draft.enabled&&draft.send)||!value.decided)throw new Error('已提交，但共享指标同意状态未能核实。')
      setSaved(value);setDraft({enabled:value.enabled,send:value.send})
    }catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:describeError(cause,language))}
    finally{if(current===generation.current){inFlight.current=false;setBusy(false)}}
  }
  return <section className="configuration-subsection"><div className="row"><h3>{zh?'共享指标':'Shared metrics'}</h3><button disabled={busy} onClick={()=>{if(!dirty||window.confirm(zh?'放弃共享指标草稿？':'Discard consent changes?'))void read()}}>{zh?'重新读取':'Reload'}</button></div>
    {!saved?<p>{error||(zh?'正在读取同意状态…':'Reading consent…')}</p>:<>
      <p>{saved.managed?(zh?'当前运行时的配置由外部管理，不能在此修改。':'The runtime configuration is managed externally.') : saved.decided?(zh?'已记录当前 Profile 的选择。':'This Profile’s choice has been recorded.'):(zh?'当前 Profile 尚未记录选择。':'This Profile has not recorded a choice.')}</p>
      <fieldset disabled={busy||saved.managed}>
        <label className="configuration-toggle"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft(previous=>({enabled:e.target.checked,send:e.target.checked&&previous.send}))}/><span>{zh?'允许本地收集共享指标':'Allow local metrics collection'}</span></label>
        <label className="configuration-toggle"><input type="checkbox" checked={draft.send} disabled={!draft.enabled} onChange={e=>setDraft(previous=>({...previous,send:e.target.checked}))}/><span>{zh?'允许向 Hermes 发送共享指标':'Allow sending shared metrics to Hermes'}</span></label>
        <p>{zh?'关闭本地收集时会同时关闭发送；点击保存后更新同意状态。':'Disabling collection also disables sending. Save to update consent.'}</p>
        <button disabled={!dirty&&saved.decided} onClick={()=>void save()}>{zh?'保存共享指标选择':'Save metrics consent'}</button>
      </fieldset>{error&&<p role="alert">{error}</p>}
    </>}
  </section>
}
