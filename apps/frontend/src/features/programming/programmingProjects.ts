import type { CodingSession, CodingProject } from '@hermess/contracts'

function windowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
}

export function projectKey(path: string): string {
  return windowsPath(path) ? path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() : path.replace(/\/+$/, '') || '/'
}

export function programmingProjects(sessions: CodingSession[], draftDirectory: string, registry: CodingProject[] = []) {
  const projects = new Map<string, { key: string; cwd: string; name: string; sessions: CodingSession[] }>()
  const add = (cwd: string) => {
    const key = projectKey(cwd)
    const display = windowsPath(cwd) ? cwd.replaceAll('\\', '/') : cwd
    if (!projects.has(key)) projects.set(key, { key, cwd, name: display.replace(/\/+$/, '').split('/').at(-1) || cwd, sessions: [] })
    return projects.get(key)!
  }
  for (const project of registry) projects.set(project.id, { key: project.id, cwd: project.cwd, name: project.name, sessions: [] })
  for (const session of sessions) {
    if (session.archived) continue
    const project = registry.find(project => session.project_id ? project.id === session.project_id : project.legacy_cwds.some(cwd => projectKey(cwd) === projectKey(session.cwd)))
    ;(project ? projects.get(project.id)! : add(session.cwd)).sessions.push(session)
  }
  if (draftDirectory && !registry.some(project => projectKey(project.cwd) === projectKey(draftDirectory))) add(draftDirectory)
  return [...projects.values()]
}
