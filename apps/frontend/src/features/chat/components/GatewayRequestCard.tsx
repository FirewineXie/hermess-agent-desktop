import type { ApprovalChoice, GatewayRequest } from '@hermess/contracts'

type Props = {
  request: GatewayRequest
  answers: Record<string, string>
  t: (key: string, ...values: unknown[]) => string
  onAnswerChange: (qid: string, value: string) => void
  onSubmit: (choice?: ApprovalChoice) => void
}

function selectedChoices(value: string, choices: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed
  } catch { /* Older answers may be plain strings. */ }
  return choices.includes(value) ? [value] : []
}

function choicePresentation(choice: string): { label: string; recommended: boolean } {
  const suffix = '(Recommended)'
  const recommended = choice.trim().toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())
  return { label: recommended ? choice.trim().slice(0, -suffix.length).trim() : choice, recommended }
}

export default function GatewayRequestCard({ request, answers, t, onAnswerChange, onSubmit }: Props) {
  if (request.method === 'approval') return <div className="request-card request-card-approval" role="alertdialog" aria-label={t('ui.tool.execution.approval')}>
    <header className="request-card-header"><span className="request-card-icon request-card-icon-approval" aria-hidden="true">!</span><div>
      <strong>{t('ui.tool.execution.approval')}</strong>
      <p>{request.params.description || request.params.tool_name || t('ui.hermes.requests.permission.to.run.a.tool')}</p>
    </div></header>
    {request.params.command && <pre className="request-command">{request.params.command}</pre>}
    <div className="request-card-actions">{(request.params.choices || ['deny']).map(choice =>
      <button className={choice === 'deny' ? 'request-action-deny' : ''} key={choice} onClick={() => onSubmit(choice)}>{({ once: t('ui.allow.once'), session: t('ui.allow.for.this.session'), always: t('ui.always.allowed'), deny: t('ui.deny') })[choice]}</button>
    )}</div>
  </div>
  return <div className="request-card request-card-clarify" role="group" aria-label={t('ui.clarifying.questions')}>
    <header className="request-card-header"><span className="request-card-icon" aria-hidden="true">?</span><div>
      <strong>{t('ui.hermes.needs.additional.information')}</strong>
      <p>{t('ui.clarifying.questions')}</p>
    </div></header>
    <div className="request-question-list">
    {request.params.questions.map(question => {
      const answer = answers[question.qid] ?? request.params.answers?.[question.qid] ?? ''
      if (question.multi_select && question.choices?.length) {
        const selected = selectedChoices(answer, question.choices)
        return <fieldset className="request-question" key={question.qid}><legend>{question.question}</legend>
          <div className="request-choice-grid">{question.choices.map(option => {
            const presentation = choicePresentation(option)
            const checked = selected.includes(option)
            return <label className={`request-choice ${checked ? 'is-selected' : ''}`} key={option}>
              <input type="checkbox" checked={checked} onChange={event => onAnswerChange(question.qid, JSON.stringify(event.target.checked ? [...selected, option] : selected.filter(item => item !== option)))} />
              <span>{presentation.label}</span>{presentation.recommended && <small>{t('ui.recommended')}</small>}
            </label>
          })}</div>
        </fieldset>
      }
      return <fieldset className="request-question" key={question.qid}><legend>{question.question}</legend>
        {question.choices?.length ? <div className="request-choice-grid" role="radiogroup">{question.choices.map(option => {
          const presentation = choicePresentation(option)
          const checked = answer === option
          return <label className={`request-choice ${checked ? 'is-selected' : ''}`} key={option}>
            <input type="radio" name={`${request.id}-${question.qid}`} checked={checked} onChange={() => onAnswerChange(question.qid, option)} />
            <span>{presentation.label}</span>{presentation.recommended && <small>{t('ui.recommended')}</small>}
          </label>
        })}</div> : <input className="request-freeform" value={answer} onChange={event => onAnswerChange(question.qid, event.target.value)} />}
      </fieldset>
    })}
    </div>
    <div className="request-card-actions"><button onClick={() => onSubmit()}>{t('ui.submit.answer')}</button></div>
  </div>
}
