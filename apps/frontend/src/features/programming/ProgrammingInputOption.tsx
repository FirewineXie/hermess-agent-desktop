import React from 'react'
import type { CodingSkill } from '@hermess/contracts'

export type InputOption = {
  id: string; label: string; description: string; skill?: CodingSkill
  icon?: string; command?: string; submenu?: boolean
}

function CommandIcon({ name }: { name?: string }) {
  const paths: Record<string, React.ReactNode> = {
    new: <><path d="M20 11.5a8.5 8.5 0 1 0-4.8 7.7L21 21l-1.8-5.8" /><path d="M8 11h8m-4-4v8" /></>,
    skills: <><path d="m8 3-5 9 5 9m8-18 5 9-5 9M14 6l-4 12" /></>,
    skill: <><path d="M7 3H4a1 1 0 0 0-1 1v3m14-4h3a1 1 0 0 1 1 1v3M3 17v3a1 1 0 0 0 1 1h3m10 0h3a1 1 0 0 0 1-1v-3M8 9h8m-8 6h8" /></>,
    review: <><path d="m3 6 2 2 4-4m-6 9 2 2 4-4m4-5h8m-8 7h8m-8 7h8" /><circle cx="5" cy="20" r="2" /></>,
    goal: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 8-8m-2 0h2v2" /></>,
    plan: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8m-8 4h8m-8 4h5" /></>,
    compact: <><path d="M4 3v5h5M20 3v5h-5M4 21v-5h5m11 5v-5h-5M4 8l5-5m11 5-5-5M4 16l5 5m11-5-5 5" /></>,
    status: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3m0 3h.01" /></>,
  }
  return <svg className="programming-command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name || 'skill'] || paths.skill}</svg>
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
    {row.submenu && <svg className="programming-command-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>}
  </button>
}
