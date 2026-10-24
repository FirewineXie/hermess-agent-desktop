import type { CommandCatalog, ComposerChoice } from '../model'

type Props = {
  visible: boolean
  choices: ComposerChoice[]
  activeChoice: number
  catalog: CommandCatalog | null
  error: string
  t: (key: string, ...values: unknown[]) => string
  onChoose: (choice: ComposerChoice) => void
}

export default function CommandSuggestions({ visible, choices, activeChoice, catalog, error, t, onChoose }: Props) {
  if (!visible) return null
  return <div className="composer-choices" role="listbox" aria-label={t('ui.commands.and.skills')}>
    {choices.map((choice, index) => <button key={choice.name} type="button" role="option" aria-selected={index === activeChoice}
      aria-disabled={!choice.available} className={`${index === activeChoice ? 'active' : ''} ${choice.available ? '' : 'unavailable'}`}
      onMouseDown={event => event.preventDefault()} onClick={() => onChoose(choice)}>
      <strong>{choice.name}</strong><span>{choice.description}</span><small>{choice.skill ? 'Skill · ' : ''}{choice.availability}</small>
    </button>)}
    {!choices.length && <p>{error || (catalog ? t('ui.no.matching.commands.or.skills') : t('ui.loading.commands.and.skills'))}</p>}
  </div>
}
