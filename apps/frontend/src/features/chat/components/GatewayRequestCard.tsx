import type { ApprovalChoice, GatewayRequest } from '@hermess/contracts'

type Props = {
  request: GatewayRequest
  answers: Record<string, string>
  t: (key: string, ...values: unknown[]) => string
  onAnswerChange: (qid: string, value: string) => void
  onSubmit: (choice?: ApprovalChoice) => void
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
    {(request.params.questions || []).map(question => <label key={question.qid}>{question.question}
      {question.choices?.length ? <select value={answers[question.qid] || ''} onChange={event => onAnswerChange(question.qid, event.target.value)}>
        <option value="">{t('ui.select')}</option>{question.choices.map(option => <option key={option} value={option}>{option}</option>)}
      </select> : <input value={answers[question.qid] || ''} onChange={event => onAnswerChange(question.qid, event.target.value)} />}
    </label>)}
    <button onClick={() => onSubmit()}>{t('ui.submit.answer')}</button>
  </div>
}
