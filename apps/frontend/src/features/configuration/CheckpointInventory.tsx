import React from 'react'
import type { CheckpointInventory as Inventory } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'

export default function CheckpointInventory({profile,language}:{profile:string;language:Language}) {
  const {security}=useDesktop()
  const zh=language==='zh-CN'
  const [inventory,setInventory]=React.useState<Inventory|null>(null)
  const [busy,setBusy]=React.useState(false)
  const [error,setError]=React.useState('')
  const generation=React.useRef(0)
  const read=async()=>{
    const current=++generation.current;setBusy(true);setError('');setInventory(null)
    try{const value=await security.checkpoints({kind:'profile',profile});if(current===generation.current)setInventory(value)}
    catch(cause){if(current===generation.current)setError(describeError(cause,language))}
    finally{if(current===generation.current)setBusy(false)}
  }
  React.useEffect(()=>{void read();return()=>{++generation.current}},[profile])
  const bytes=(value:number)=>value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} KiB`:`${(value/1024/1024).toFixed(1)} MiB`
  return <section className="configuration-subsection"><div className="row"><h3>{zh?'检查点存储清单':'Checkpoint storage'}</h3><button disabled={busy} onClick={()=>void read()}>{zh?'刷新清单':'Refresh'}</button></div>
    <p>{zh?'按当前 Profile 读取存储目录和占用，不提供恢复或删除操作。':'Read stored directories and sizes for this Profile. Restore and delete actions are unavailable.'}</p>
    {error?<p role="alert">{error}</p>:!inventory?<p>{zh?'正在读取清单…':'Loading inventory…'}</p>:<>
      <p>{zh?'会话目录':'Session directories'}：{inventory.sessions.length} · {zh?'总占用':'Total'}：{bytes(inventory.total_bytes)}</p>
      {!inventory.sessions.length?<p>{zh?'当前 Profile 没有已保存的检查点目录。':'No saved checkpoint directories for this Profile.'}</p>:<div className="configuration-inventory">{inventory.sessions.map(item=><div key={item.session}><code>{item.session}</code><span>{item.files} {zh?'个文件':'files'}</span><span>{bytes(item.bytes)}</span></div>)}</div>}
    </>}
  </section>
}
