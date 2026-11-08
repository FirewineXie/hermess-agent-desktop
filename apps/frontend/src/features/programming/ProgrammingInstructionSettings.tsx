import React from 'react'
import type { CodingProject, CodingTextFile } from '@hermess/contracts'
import type { CodingSettingsController } from './useCodingSettings'

export default function ProgrammingInstructionSettings({ controller: c, zh }: { controller: CodingSettingsController; zh: boolean }) {
  const instructions = c.draft!.instructions
  const [projects, setProjects] = React.useState<CodingProject[] | null>(null)
  const [cwd, setCwd] = React.useState('')
  const [file, setFile] = React.useState<CodingTextFile | null>(null)
  const [content, setContent] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const attempted = React.useRef(false)
  const dirty = Boolean(file && file.content !== content)
  React.useEffect(() => { c.setExtraDirty(dirty); return () => c.setExtraDirty(false) }, [dirty, c.setExtraDirty])
  React.useEffect(() => {
    if (attempted.current || c.busy) return
    attempted.current = true
    void c.run(async () => setProjects(await c.api.coding.projects()))
  }, [projects, c.busy, c.api.coding, c.run])
  const select = (next: string) => {
    if (dirty && !window.confirm(zh ? '丢弃未保存的项目指令？' : 'Discard unsaved project instructions?')) return
    setCwd(next); setFile(null); setContent(''); setSaved(false)
    if (next) void c.run(async () => { const value = await c.api.coding.projectInstruction(next); setFile(value); setContent(value.content) })
  }
  return <>
    <div className="programming-settings-fields"><label>{zh ? '全局编程指令' : 'Global programming instructions'}<textarea className="programming-settings-code" maxLength={65536} value={instructions.developer_instructions} onChange={event => c.change({ instructions: { ...instructions, developer_instructions: event.target.value } })} /></label>
      <label>{zh ? '项目指令最大读取字节数' : 'Maximum project instruction bytes'}<input type="number" min="0" max={1048576} value={instructions.project_doc_max_bytes} onChange={event => c.change({ instructions: { ...instructions, project_doc_max_bytes: Number(event.target.value) } })} /></label>
      <label>{zh ? '找不到 AGENTS.md 时的候选文件名（每行一个）' : 'Fallback filenames when AGENTS.md is absent (one per line)'}<textarea value={instructions.project_doc_fallback_filenames.join('\n')} onChange={event => c.change({ instructions: { ...instructions, project_doc_fallback_filenames: event.target.value.split('\n').filter(Boolean) } })} /></label>
    </div>
    <fieldset className="programming-settings-fieldset"><legend>{zh ? '项目 AGENTS.md' : 'Project AGENTS.md'}</legend><p>{zh ? '此处直接读写已登记项目根目录中的 AGENTS.md，可能由项目 Git 跟踪；它与上面的全局配置分别保存。' : 'This edits AGENTS.md in the registered project root. Git may track this file. Save it separately from global settings.'}</p>
      <select aria-label={zh ? '项目指令所属项目' : 'Project instructions scope'} value={cwd} onChange={event => select(event.target.value)}><option value="">{zh ? '选择项目' : 'Choose project'}</option>{projects?.map(project => <option value={project.cwd} key={project.id}>{project.name}</option>)}</select>
      {file && <><p className="programming-settings-path">{file.path}</p><label>AGENTS.md<textarea className="programming-settings-code" value={content} maxLength={1048576} onChange={event => { setContent(event.target.value); setSaved(false) }} /></label><button type="button" disabled={c.busy || !dirty} onClick={() => void c.run(async () => { const value = await c.api.coding.saveProjectInstruction(cwd, file.revision, content); setFile(value); setContent(value.content); setSaved(true) })}>{zh ? '保存项目指令' : 'Save project instructions'}</button>{saved && <p className="programming-saved" role="status">{zh ? '项目指令已保存，下一轮生效。' : 'Project instructions saved; applies from the next turn.'}</p>}</>}
    </fieldset>
  </>
}
