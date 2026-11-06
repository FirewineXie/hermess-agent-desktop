export type ToolsetProviderAccountBoundary = {
  requires_nous_auth?: boolean
  managed_nous_feature?: string | null
}

export function visibleToolsetProviders<T extends ToolsetProviderAccountBoundary>(providers: T[]): T[] {
  return providers.filter(provider => !provider.requires_nous_auth && !provider.managed_nous_feature)
}
