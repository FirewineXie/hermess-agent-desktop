export type CodingCommand =
  | { type: 'goal'; action: 'get' | 'set' | 'update' | 'pause' | 'resume' | 'clear'; objective?: string; token_budget?: number }
  | { type: 'plan'; mode: 'plan' | 'default'; prompt?: string }
  | { type: 'compact' }
  | { type: 'review'; target: { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string } | { type: 'commit'; sha: string; title: string | null } | { type: 'custom'; instructions: string } }
export type CodingGoal = {
  threadId: string; objective: string; status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
  tokenBudget: number | null; tokensUsed: number; timeUsedSeconds: number; createdAt: number; updatedAt: number
}
export type CodingQuestion = {
  id: string
  questions: { id: string; header: string; question: string; isOther: boolean; isSecret: boolean; options: { label: string; description: string }[] | null }[]
}
