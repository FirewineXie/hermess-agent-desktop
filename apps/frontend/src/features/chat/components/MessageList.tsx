type Message = { role: string; text: string }

export default function MessageList({ messages, assistant, t }: { messages: Message[]; assistant: string; t: (key: string) => string }) {
  if (!messages.length && !assistant) return <div className="welcome"><span className="hero-mark">H</span><h2>{t('ui.hello.what.do.you.want.to.do.today')}</h2><p>{t('ui.describe.a.task.to.hermess.or.add.files.to.work.on.together')}</p></div>
  return <div className="messages">{messages.map((message, index) =>
    <p key={index}><strong>{message.role === 'user' ? t('ui.you') : 'Hermes'}：</strong>{message.text}</p>
  )}{assistant && <p><strong>Hermes：</strong>{assistant}</p>}</div>
}
