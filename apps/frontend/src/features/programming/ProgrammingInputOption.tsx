import React from 'react'
import type { CodingSkill } from '@hermess/contracts'
import Icon, { type IconName } from '../../app/Icon'

export type InputOption = {
  id: string; label: string; description: string; skill?: CodingSkill
  icon?: string; command?: string; submenu?: boolean
}

function CommandIcon({ name }: { name?: string }) {
  const icons: Record<string, IconName> = {
    new: 'plus', skills: 'code', skill: 'sparkles', review: 'tasks', goal: 'target',
    plan: 'list', compact: 'minimize', status: 'scheduled', settings: 'sliders', help: 'help',
  }
  return <Icon className="programming-command-icon" name={icons[name || 'skill'] || 'sparkles'} />
}

export default function ProgrammingInputOption({ row, index, selected, onChoose }: {
  row: InputOption; index: number; selected: boolean; onChoose(): void
}) {
  return <button className="programming-input-option" type="button" role="option" aria-selected={selected}
    id={`programming-input-option-${index}`} title={`${row.command || row.label} · ${row.description}`}
    onMouseDown={event => event.preventDefault()} onClick={onChoose}>
    <CommandIcon name={row.icon} />
    {row.command && <span className="programming-command-name">{row.command}</span>}
    <span className="programming-command-label">{row.label}</span>
    <span className="programming-command-description">{row.description}</span>
    {row.submenu && <Icon className="programming-command-arrow" name="chevronRight" />}
  </button>
}
