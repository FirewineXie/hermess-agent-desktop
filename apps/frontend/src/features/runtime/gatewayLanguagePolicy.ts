export function gatewayLanguageDecision(
  configured: unknown,
  managed: string | null,
  desired: 'zh' | 'en',
): 'preserve' | 'same' | 'write' {
  if (configured !== undefined && configured !== managed) return 'preserve'
  if (configured === desired || (configured === undefined && desired === 'en')) return 'same'
  return 'write'
}
