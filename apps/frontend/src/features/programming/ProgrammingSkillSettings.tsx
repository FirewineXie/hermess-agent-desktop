import React from 'react'
import type { CodingProject, CodingSkillCatalog } from '@hermess/contracts'
import type { CodingSettingsController } from './useCodingSettings'

export default function ProgrammingSkillSettings({ controller: c, zh }: { controller: CodingSettingsController; zh: boolean }) {
  const [projects, setProjects] = React.useState<CodingProject[] | null>(null)
  const [cwd, setCwd] = React.useState('')
  const [catalog, setCatalog] = React.useState<CodingSkillCatalog | null>(null)
  const attempted = React.useRef(false)
  const scan = () => c.run(async () => { const [projects, skills] = await Promise.all([c.api.coding.projects(), c.api.coding.skills(cwd)]); setProjects(projects); setCatalog(skills) })
  React.useEffect(() => {
    if (attempted.current || c.busy) return
    attempted.current = true
    void c.run(async () => { const [projects, skills] = await Promise.all([c.api.coding.projects(), c.api.coding.skills('')]); setProjects(projects); setCatalog(skills) })
  }, [projects, c.busy, c.api.coding, c.run])
  return <>
    <p>{zh ? '此页只展示实际发现的 Skills。技能内容直接在技能目录中配置；启停规则在 config.toml 的 skills.config 中配置。' : 'This page lists discovered skills. Edit skill files in their folders and activation rules under skills.config in config.toml.'}</p>
    <div className="programming-provider-actions"><button type="button" disabled={c.busy} onClick={() => void c.run(() => c.api.coding.openSkillDirectory())}>{zh ? '打开独立技能目录' : 'Open managed skills folder'}</button>
      <select aria-label={zh ? '技能所属项目' : 'Project for skills'} value={cwd} onChange={event => { setCwd(event.target.value); setCatalog(null) }}><option value="">{zh ? '仅全局技能' : 'Global skills only'}</option>{projects?.map(project => <option key={project.id} value={project.cwd}>{project.name}</option>)}</select>
      <button type="button" disabled={c.busy} onClick={() => void scan()}>{zh ? '重新扫描' : 'Rescan'}</button></div>
    {catalog?.skills.map((skill, index) => <div className="programming-settings-fieldset" key={skill.path + ':' + index}><strong>{skill.name}</strong><p>{skill.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已禁用' : 'Disabled')}</p><p>{skill.description}</p><p className="programming-settings-path">{skill.path}</p></div>)}
    {catalog?.errors.map((error, index) => <p role="alert" className="programming-error programming-settings-path" key={index}>{error.path}: {error.message}</p>)}
    {catalog && !catalog.skills.length && <p>{zh ? '当前范围没有可用技能。' : 'No skills in this scope.'}</p>}
  </>
}
