function plainChoice(value: string): string {
  return value.trim().replace(/\s*\(Recommended\)$/i, '').trim()
}

export function composeClarifyAnswer(selected: string | null | undefined, supplement: string | undefined, multiSelect = false): string | null {
  const note = supplement?.trim() || ''
  if (multiSelect) {
    let choices: string[] = []
    if (selected) {
      try {
        const parsed: unknown = JSON.parse(selected)
        choices = Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : [selected]
      } catch { choices = [selected] }
    }
    const answers = choices.map(plainChoice).filter(Boolean)
    if (note) answers.push(note)
    return answers.length ? JSON.stringify(answers) : null
  }
  const choice = selected ? plainChoice(selected) : ''
  if (choice && note) return `${choice}\n补充说明：${note}`
  return choice || note || null
}
