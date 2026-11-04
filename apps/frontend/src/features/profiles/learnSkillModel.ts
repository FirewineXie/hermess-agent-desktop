export type LearnSkillSources = { directory?: string; url?: string; notes?: string }

export function composeLearnSkillCommand({ directory = '', url = '', notes = '' }: LearnSkillSources): string {
  const segments: string[] = []
  if (directory.trim()) segments.push(`local source: ${directory.trim()}`)
  if (url.trim()) segments.push(`URL: ${url.trim()}`)
  if (notes.trim()) segments.push(notes.trim())
  const prompt = segments.join('; ').replace(/\s*\n\s*/g, ' ').trim()
  return prompt ? `/learn ${prompt}` : ''
}
