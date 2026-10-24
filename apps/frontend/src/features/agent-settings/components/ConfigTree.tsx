import React from 'react'
import type { Language } from '../../../i18n'
import { fieldTree, nodeLabel, type Field, type FieldEntry, type FieldNode } from '../model'
import ConfigFieldEditor from './ConfigFieldEditor'

type Props = {
  visible: FieldEntry[]
  queryActive: boolean
  config: Record<string, unknown>
  drafts: Record<string, string>
  editingKey: string | null
  busy: boolean
  language: Language
  t: (key: string, ...values: unknown[]) => string
  expandedPaths: Set<string>
  setExpandedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  onEdit: (key: string) => void
  onChange: (key: string, value: string) => void
  onSave: (key: string, field: Field) => void
  onCancel: () => void
}

export default function ConfigTree({ visible, queryActive, config, drafts, editingKey, busy, language, t,
  expandedPaths, setExpandedPaths, onEdit, onChange, onSave, onCancel }: Props) {
  const tree = fieldTree(visible)

  function renderField(entry: FieldEntry) {
    const [key] = entry
    return <ConfigFieldEditor key={key} entry={entry} config={config} draft={drafts[key]}
      editing={editingKey === key} busy={busy} language={language} t={t}
      onEdit={onEdit} onChange={onChange}
      onSave={([fieldKey, field]) => onSave(fieldKey, field)} onCancel={onCancel} />
  }

  function renderNode(node: FieldNode): React.ReactNode {
    if (!node.children.size) return node.field && renderField(node.field)
    return <details className="config-tree-node" key={node.path} open={queryActive || expandedPaths.has(node.path)} onToggle={event => {
      if (queryActive) return
      const opened = event.currentTarget.open
      setExpandedPaths(previous => {
        if (previous.has(node.path) === opened) return previous
        const next = new Set(previous)
        if (opened) next.add(node.path)
        else next.delete(node.path)
        return next
      })
    }}>
      <summary>{nodeLabel(language, node, visible)}</summary>
      <div className="config-tree-children">
        {node.field && renderField(node.field)}
        {[...node.children.values()].map(renderNode)}
      </div>
    </details>
  }

  return <div className="config-tree-root">
    <div className="config-tree-root-heading">{t('ui.all.settings')} <span>{visible.length}</span></div>
    <div className="config-fields">{[...tree.children.values()].map(renderNode)}</div>
  </div>
}
