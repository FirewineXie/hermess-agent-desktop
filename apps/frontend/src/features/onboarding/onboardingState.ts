export type OnboardingStatus = 'in-progress' | 'completed' | 'skipped' | null

export function shouldOpenOnboarding(freshInstallation: boolean, status: OnboardingStatus): boolean {
  return status === 'in-progress' || (freshInstallation && status === null)
}
