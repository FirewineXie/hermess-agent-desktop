import React from 'react'
import { addWorkspace, migrateLegacySelection, readWorkspacePreferences, removeWorkspace, removeWorkspaceProfile, renameWorkspaceProfile, samePath, selectedWorkspace, selectWorkspace } from './workspacePreferences.ts'

const storageKey = 'hermess.workspaces.v2'
const legacyStorageKey = 'hermess.workspaces.v1'

function readSaved() {
  return readWorkspacePreferences(localStorage.getItem(storageKey), localStorage.getItem(legacyStorageKey))
}

export function useWorkspaces(profile: string | null) {
  const [saved, setSaved] = React.useState(readSaved)

  React.useEffect(() => {
    setSaved(current => migrateLegacySelection(current, profile))
  }, [profile])

  React.useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)) } catch { /* The current session still works without persistence. */ }
  }, [saved])

  function add(path: string) {
    setSaved(current => addWorkspace(current, profile, path))
    console.info('[workspace] shortcut added', { profile, assignedAsAgentDefault: Boolean(profile) })
  }

  function select(path: string) {
    setSaved(current => selectWorkspace(current, profile, path))
    console.info('[workspace] Agent default selected', { profile, specified: Boolean(path) })
  }

  function assignProfile(targetProfile: string, path: string) {
    setSaved(current => selectWorkspace(current, targetProfile, path))
    console.info('[workspace] Agent default assigned', { profile: targetProfile, specified: Boolean(path) })
  }

  function remove(path: string) {
    setSaved(current => removeWorkspace(current, path))
    console.info('[workspace] shortcut removed', { clearedAgentDefaults: Object.values(saved.selectedByProfile).filter(selected => samePath(selected, path)).length })
  }

  function renameProfile(previousProfile: string, nextProfile: string) {
    setSaved(current => renameWorkspaceProfile(current, previousProfile, nextProfile))
  }

  function removeProfile(removedProfile: string) {
    setSaved(current => removeWorkspaceProfile(current, removedProfile))
  }

  return {
    paths: saved.paths,
    selected: selectedWorkspace(saved, profile),
    selectedForProfile: (targetProfile: string) => selectedWorkspace(saved, targetProfile),
    add,
    select,
    assignProfile,
    remove,
    renameProfile,
    removeProfile,
  }
}
