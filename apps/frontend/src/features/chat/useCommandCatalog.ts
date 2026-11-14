import type { DesktopApi, ProfileScope, SessionScope } from '@hermess/contracts'
import { useProfileRef, useProfileState } from '../../app/profile-scope/ProfileWorkspace'
import type { CommandCatalog } from './model'

export function useCommandCatalog(
  chat: DesktopApi['chat'], workspace: string, session: { current: string },
  profileScope: () => ProfileScope, sessionScope: (id: string) => SessionScope, errorText: (cause: unknown) => string,
) {
  const [commandCatalog, setCatalog] = useProfileState<CommandCatalog | null>(workspace, null, 'chat:command-catalog')
  const [commandCatalogError, setError] = useProfileState(workspace, '', 'chat:command-catalog-error')
  const pending = useProfileRef<Promise<CommandCatalog> | null>(workspace, null)

  function invalidateCommandCatalog() {
    setCatalog(null)
    setError('')
    pending.current = null
  }

  function loadCommandCatalog(): Promise<CommandCatalog> {
    if (commandCatalog) return Promise.resolve(commandCatalog)
    if (!pending.current) {
      const id = session.current
      const scope = id ? sessionScope(id) : profileScope()
      setError('')
      const request = chat.commands(scope).then(catalog => {
        if (session.current === id && pending.current === request) {
          setCatalog(catalog)
          setError(catalog.warning || '')
        }
        return catalog
      }).catch(cause => {
        if (pending.current === request) {
          pending.current = null
          setError(errorText(cause))
        }
        throw cause
      })
      pending.current = request
    }
    return pending.current
  }

  return { commandCatalog, commandCatalogError, loadCommandCatalog, invalidateCommandCatalog }
}
