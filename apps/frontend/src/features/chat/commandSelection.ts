import type { ComposerChoice } from './model'
import type { composerTrigger } from './model'

export function selectCommand(options: {
  choice: ComposerChoice
  trigger: ReturnType<typeof composerTrigger>
  draft: string
  setDraft: (value: string) => void
  setCaret: (value: number) => void
  setActiveChoice: (value: number) => void
  setStatus: (value: string) => void
  input: { current: HTMLTextAreaElement | null }
}) {
  const { choice, trigger, draft, setDraft, setCaret, setActiveChoice, setStatus, input } = options
  if (!trigger) return
  if (!choice.available) { setStatus(`${choice.name}：${choice.availability}`); return }
  const replacement = `${choice.insertion || choice.name} `
  const caret = trigger.start + replacement.length
  setDraft(`${draft.slice(0, trigger.start)}${replacement}${draft.slice(trigger.end)}`)
  setCaret(caret)
  setActiveChoice(0)
  requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(caret, caret) })
}
