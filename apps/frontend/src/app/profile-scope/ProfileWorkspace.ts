import React from 'react'

const workspaceValues = new Map<string, unknown>()
let activeEpoch = 'offline'
let workspaceGeneration = 0

/** Retire all state from a previous Gateway connection before publishing its replacement. */
export function activateWorkspaceEpoch(epoch: string | null | undefined, force = false): number {
  const next = epoch || 'offline'
  if (activeEpoch === next && !force) return workspaceGeneration
  activeEpoch = next
  workspaceGeneration += 1
  workspaceValues.clear()
  return workspaceGeneration
}

export function workspaceKey(epoch: string | null | undefined, profile: string | null | undefined): string {
  return `${epoch || 'offline'}\u0000${profile || 'unselected'}`
}

/** Keeps each feature's UI state in the workspace that started the operation. */
export function useProfileState<T>(key: string, initial: T | (() => T), cacheSlot?: string): [T, React.Dispatch<React.SetStateAction<T>>] {
  const slot = React.useId()
  const [, render] = React.useState(0)
  const address = `${cacheSlot || slot}\u0000${key}`
  const generation = workspaceGeneration
  const fallback = () => typeof initial === 'function' ? (initial as () => T)() : initial
  const value = workspaceValues.has(address) ? workspaceValues.get(address) as T : fallback()
  const setValue: React.Dispatch<React.SetStateAction<T>> = update => {
    // An in-flight request may finish after a disconnect. Its old workspace is retired.
    if (generation !== workspaceGeneration || key.split('\u0000', 1)[0] !== activeEpoch) return
    const before = workspaceValues.has(address) ? workspaceValues.get(address) as T : fallback()
    const after = typeof update === 'function' ? (update as (before: T) => T)(before) : update
    if (Object.is(before, after)) return
    workspaceValues.set(address, after)
    render(count => count + 1)
  }
  return [value, setValue]
}

export function useProfileRef<T>(key: string, initial: T): React.MutableRefObject<T> {
  const values = React.useRef<Record<string, T>>({})
  return {
    get current() {
      if (!Object.prototype.hasOwnProperty.call(values.current, key)) values.current[key] = initial
      return values.current[key]
    },
    set current(value: T) { values.current[key] = value },
  }
}
