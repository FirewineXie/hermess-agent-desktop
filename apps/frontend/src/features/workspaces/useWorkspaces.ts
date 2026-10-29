import React from 'react'
import { displayPath } from '../../shared/displayPath'

const storageKey = 'hermess.workspaces.v1'

type SavedWorkspaces = { paths: string[]; selected: string }

function readSaved(): SavedWorkspaces {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<SavedWorkspaces>
    const paths = Array.isArray(value.paths) ? value.paths.filter((path): path is string => typeof path === 'string' && Boolean(path.trim())).map(displayPath) : []
    const selected = typeof value.selected === 'string' ? displayPath(value.selected) : ''
    return { paths, selected: paths.includes(selected) ? selected : '' }
  } catch { return { paths: [], selected: '' } }
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll('/', '\\').replace(/[\\]+$/, '').toLocaleLowerCase() === right.replaceAll('/', '\\').replace(/[\\]+$/, '').toLocaleLowerCase()
}

export function useWorkspaces() {
  const [saved, setSaved] = React.useState(readSaved)

  React.useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)) } catch { /* The current session still works without persistence. */ }
  }, [saved])

  function add(path: string) {
    path = displayPath(path)
    setSaved(current => {
      const existing = current.paths.find(item => samePath(item, path))
      return existing ? { ...current, selected: existing } : { paths: [...current.paths, path], selected: path }
    })
  }

  function select(path: string) {
    path = displayPath(path)
    setSaved(current => ({ ...current, selected: path === '' || current.paths.includes(path) ? path : current.selected }))
  }

  function remove(path: string) {
    path = displayPath(path)
    setSaved(current => ({ paths: current.paths.filter(item => item !== path), selected: current.selected === path ? '' : current.selected }))
  }

  return { paths: saved.paths, selected: saved.selected, add, select, remove }
}
