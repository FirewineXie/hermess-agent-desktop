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

export default function GatewayRequestCard({ request, answers, t, onAnswerChange, onSubmit }: Props) {
  if (request.method === 'approval') return <div className="request-card" role="alertdialog" aria-label={t('ui.tool.execution.approval')}>
    <strong>{t('ui.tool.execution.approval')}</strong>
    <p>{request.params.description || request.params.tool_name || t('ui.hermes.requests.permission.to.run.a.tool')}</p>
    {request.params.command && <pre>{request.params.command}</pre>}
    <div className="actions">{(request.params.choices || ['deny']).map(choice =>
      <button key={choice} onClick={() => onSubmit(choice)}>{({ once: t('ui.allow.once'), session: t('ui.allow.for.this.session'), always: t('ui.always.allowed'), deny: t('ui.deny') })[choice]}</button>
    )}</div>
  </div>
  return <div className="request-card" role="group" aria-label={t('ui.clarifying.questions')}>
    <strong>{t('ui.hermes.needs.additional.information')}</strong>
    {request.params.questions.map(question => {
      const answer = answers[question.qid] ?? request.params.answers?.[question.qid] ?? ''
      if (question.multi_select && question.choices?.length) {
        const selected = selectedChoices(answer, question.choices)
        return <fieldset key={question.qid}><legend>{question.question}</legend>
          {question.choices.map(option => <label key={option}>
            <input type="checkbox" checked={selected.includes(option)} onChange={event => onAnswerChange(question.qid, JSON.stringify(event.target.checked ? [...selected, option] : selected.filter(item => item !== option)))} />
            {option}
          </label>)}
        </fieldset>
      }
      return <label key={question.qid}>{question.question}
        {question.choices?.length ? <select value={answer} onChange={event => onAnswerChange(question.qid, event.target.value)}>
          <option value="">{t('ui.select')}</option>{question.choices.map(option => <option key={option} value={option}>{option}</option>)}
        </select> : <input value={answer} onChange={event => onAnswerChange(question.qid, event.target.value)} />}
      </label>
    })}
    <button onClick={() => onSubmit()}>{t('ui.submit.answer')}</button>
  </div>
}
