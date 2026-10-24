import type { AgentToolset } from '@hermess/contracts'

type Props = {
  group: AgentToolset
  searchTerm: string
  descriptions: Map<string, string>
  hasActiveState: boolean
  t: (key: string, ...values: unknown[]) => string
}

export default function ToolsetCard({ group, searchTerm, descriptions, hasActiveState, t }: Props) {
  const names = !searchTerm || [group.name, group.description].some(value => value.toLowerCase().includes(searchTerm))
    ? group.tools || []
    : (group.tools || []).filter(name => name.toLowerCase().includes(searchTerm))
  return <details className="config-tree-node" open={Boolean(searchTerm)}>
    <summary><strong>{group.name}</strong><span>{group.enabled ? t('ui.enabled') : t('ui.disabled')} · {group.tool_count} {t('ui.items')}</span></summary>
    <div className="config-tree-children">
      {group.description && <p>{group.description}</p>}
      {names.map(name => {
        const description = descriptions.get(name)
        const content = <><code>{name}</code>{hasActiveState && <span>{descriptions.has(name) ? t('ui.available.in.this.session') : t('ui.unavailable.in.this.session')}</span>}</>
        return description
          ? <details className="tool-item" key={name}><summary>{content}</summary><p>{description}</p></details>
          : <div className="tool-item tool-item-static" key={name}><div>{content}</div></div>
      })}
    </div>
  </details>
}
