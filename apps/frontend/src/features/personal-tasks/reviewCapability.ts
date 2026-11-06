export type ReviewCapability = 'ready' | 'missing' | 'unavailable'
export type ReviewCapabilities = Record<string, ReviewCapability>

export function normalizeReviewCapability(capability: string | undefined): ReviewCapability {
  return capability === 'ready' || capability === 'missing' ? capability : 'unavailable'
}

export function reviewCapabilityLabel(capability: ReviewCapability | undefined): string {
  if (capability === 'ready') return '可自动审核'
  if (capability === 'missing') return '未启用审核技能'
  return '审核能力未知'
}

export function cannotReceiveReview(status: string, capability: ReviewCapability | undefined): boolean {
  return status === 'review' && capability === 'missing'
}

export function resolveReviewImplementer(
  recordedImplementer: string | null | undefined,
  currentAssignee: string | null | undefined,
): string {
  return recordedImplementer?.trim() || currentAssignee?.trim() || ''
}

export function isReviewSelfAssignment(reviewer: string, implementer: string): boolean {
  return Boolean(reviewer && implementer && reviewer === implementer)
}
