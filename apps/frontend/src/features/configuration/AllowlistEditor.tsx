import React from 'react'
import type { Language } from '../../i18n'
import { allowlistFromText } from './model'

export default function AllowlistEditor({text,busy,editing,language,onEdit,onChange,onSave,onCancel}:{text:string;busy:boolean;editing:boolean;language:Language;onEdit:()=>void;onChange:(value:string)=>void;onSave:()=>void;onCancel:()=>void}){
  const zh=language==='zh-CN'
  let rows:string[]
  try{rows=allowlistFromText(text)}catch{return <p role="alert">{zh?'当前命令允许列表不是字符串数组，请从完整 YAML 检查。':'The allowlist is not a string array. Inspect the full YAML.'}</p>}
  const update=(next:string[])=>onChange(JSON.stringify(next,null,2))
  return <section className="configuration-subsection"><div className="row"><h3>{zh?'命令允许列表':'Command allowlist'}</h3>{!editing&&<button disabled={busy} onClick={onEdit}>{zh?'编辑列表':'Edit list'}</button>}</div>
    {editing?<fieldset disabled={busy}>{rows.map((row,index)=><div className="configuration-list-row" key={index}><input aria-label={zh?`允许规则 ${index+1}`:`Allowed rule ${index+1}`} value={row} onChange={e=>update(rows.map((value,i)=>i===index?e.target.value:value))}/><button onClick={()=>update(rows.filter((_,i)=>i!==index))}>{zh?'移除':'Remove'}</button></div>)}
      <button onClick={()=>update([...rows,''])}>{zh?'添加规则':'Add rule'}</button><div className="actions"><button disabled={rows.some(row=>!row.trim())} onClick={onSave}>{zh?'保存列表':'Save list'}</button><button onClick={onCancel}>{zh?'取消':'Cancel'}</button></div>
    </fieldset>:<p>{rows.length?rows.join(' · '):(zh?'没有允许规则。':'No allowlist rules.')}</p>}
  </section>
}
