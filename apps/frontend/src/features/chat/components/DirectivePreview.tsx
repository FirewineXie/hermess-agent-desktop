import React from 'react'
import type { MediaScope } from '@hermess/contracts'
import { useDesktop } from '../../../app/DesktopContext'
import { useChatMediaScope } from '../ChatMediaContext'
import LocalPreview from './LocalPreview'

type Props = { path: string; language: 'zh-CN' | 'en-US' }

export default function DirectivePreview(props: Props) {
  const scope = useChatMediaScope()
  return scope ? <ScopedDirectivePreview {...props} scope={scope} /> : <LocalPreview {...props} />
}

function ScopedDirectivePreview({ scope, ...props }: Props & { scope: MediaScope }) {
  const { media } = useDesktop()
  const readHtml = React.useCallback(async (path: string) => {
    const resource = await media.prepare(scope, path)
    try {
      const preview = await media.preview(resource.id)
      if (preview.kind !== 'html' || preview.truncated) throw new Error('HTML preview unavailable')
      return { content: preview.content }
    } finally {
      try { await media.release(resource.id) } catch { console.error('[chat-media] directive resource release failed') }
    }
  }, [media, scope.gatewayEpoch, scope.profile, scope.sessionId])
  return <LocalPreview {...props} readHtml={readHtml} />
}
