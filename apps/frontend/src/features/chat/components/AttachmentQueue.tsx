import type { PendingAttachment } from '@hermess/contracts'
import { displayPath } from '../../../shared/displayPath'

type Props = {
  attachments: PendingAttachment[]
  busy: boolean
  t: (key: string, ...values: unknown[]) => string
  onRemove: (index: number) => void
}

export default function AttachmentQueue({ attachments, busy, t, onRemove }: Props) {
  if (!attachments.length) return null
  return <ul>{attachments.map((attachment, index) => <li key={`${attachment.path || attachment.ref_text}-${index}`}>
    <span>{attachment.kind === 'image' ? t('ui.image') : t('ui.file')}：{attachment.name}（{attachment.bytes} {t('ui.bytes')}</span>
    <button disabled={busy} onClick={() => onRemove(index)}>{t('ui.remove')}</button>
    <code title={t('ui.source.path')}>{displayPath(attachment.source_path)}</code>
    {attachment.preview && <details><summary>{t('ui.text.preview')}</summary><pre>{attachment.preview}</pre></details>}
  </li>)}</ul>
}
