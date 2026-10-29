/** Remove Windows extended-length syntax only when a familiar display form exists. */
export function displayPath(path: string): string {
  const prefix = '\\\\?\\'
  const windowsPath = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
  const value = windowsPath ? path.replaceAll('/', '\\') : path
  if (!value.startsWith(prefix)) return value
  const rest = value.slice(prefix.length)
  if (/^[A-Za-z]:\\/.test(rest)) return rest
  if (rest.startsWith('UNC\\')) return `\\\\${rest.slice(4)}`
  return value
}
