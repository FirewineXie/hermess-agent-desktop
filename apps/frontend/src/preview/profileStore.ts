/** The browser preview mirrors Profile isolation without writing product data. */
export function createPreviewProfileStore<T>(seed: T) {
  const values = new Map<string, T>()
  return (profile: string): T => {
    let value = values.get(profile)
    if (value === undefined) {
      value = structuredClone(seed)
      values.set(profile, value)
    }
    return value
  }
}
