import type { DesktopApi, MediaResource, MediaScope } from '@hermess/contracts'

type MediaApi = DesktopApi['media']

/** A prepared resource belongs to exactly one mounted source and scope. */
export function prepareMediaResource(
  api: MediaApi, scope: MediaScope, source: string,
  onReady: (resource: MediaResource) => void, onError: () => void,
  operation = crypto.randomUUID().slice(0, 8),
): () => void {
  let disposed = false
  let resource: MediaResource | null = null
  const release = (id: string) => {
    void api.release(id).then(
      () => console.info('[chat-media] resource released', { operation }),
      () => console.error('[chat-media] release failed', { operation }),
    )
  }
  console.info('[chat-media] prepare started', { operation })
  void api.prepare(scope, source).then(value => {
    if (disposed) { release(value.id); return }
    resource = value
    console.info('[chat-media] prepare completed', { operation, kind: value.kind, local: value.local })
    onReady(value)
  }, () => {
    if (disposed) return
    console.error('[chat-media] prepare failed', { operation })
    onError()
  })
  return () => {
    if (disposed) return
    disposed = true
    if (resource) release(resource.id)
  }
}
