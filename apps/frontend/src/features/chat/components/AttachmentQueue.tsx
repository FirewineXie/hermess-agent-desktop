import type { PendingAttachment } from '@hermess/contracts'
import { displayPath } from '../../../shared/displayPath'
import './attachment-queue.css'

type Props = {
  attachments: PendingAttachment[]
  busy: boolean
  t: (key: string, ...values: unknown[]) => string
  onRemove: (index: number) => void
}

export default function AttachmentQueue({ attachments, busy, t, onRemove }: Props) {
  if (!attachments.length) return null
  return <ul className="attachment-queue">{attachments.map((attachment, index) => <li key={`${attachment.path || attachment.ref_text}-${index}`}>
    {attachment.kind === 'image' && attachment.image_preview && <img className="attachment-thumbnail" src={attachment.image_preview} alt={attachment.name} width={64} height={64} />}
    <span className="attachment-description">{attachment.kind === 'image' ? t('ui.image') : t('ui.file')}：{attachment.name}（{attachment.bytes} {t('ui.bytes')}</span>
    <button type="button" disabled={busy} onClick={() => onRemove(index)}>{t('ui.remove')}</button>
    {attachment.source_path !== 'clipboard' && <code title={t('ui.source.path')}>{displayPath(attachment.source_path)}</code>}
    {attachment.preview && <details><summary>{t('ui.text.preview')}</summary><pre>{attachment.preview}</pre></details>}
  </li>)}</ul>
}
