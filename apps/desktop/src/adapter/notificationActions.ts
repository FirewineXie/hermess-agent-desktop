/** macOS may report an action title while Windows reports the registered ID. */
export function notificationApprovalChoice(actionId: string): 'once' | 'deny' | null {
  if (['approve', '允许一次', 'Allow once'].includes(actionId)) return 'once'
  if (['deny', '拒绝', 'Reject'].includes(actionId)) return 'deny'
  return null
}
