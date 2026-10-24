import type { RuntimeProbe } from '@hermess/contracts'

export default function RuntimeProbeCard({ probe, t }: { probe: RuntimeProbe; t: (key: string) => string }) {
  return <details className="tool-item">
    <summary><strong>{probe.tool}</strong><span>{probe.usable ? (probe.kind === 'command' ? t('ui.available') : t('ui.compatible.candidate')) : t('ui.not.available')}</span></summary>
    <small>{probe.version ?? probe.reason}</small>
    {probe.path && <code>{probe.path}</code>}
  </details>
}
