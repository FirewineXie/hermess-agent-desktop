/** Remove Windows extended-length syntax only when a familiar display form exists. */
export function displayPath(path: string): string {
  const prefix = '\\\\?\\'
  if (!path.startsWith(prefix)) return path
  const rest = path.slice(prefix.length)
  if (/^[A-Za-z]:\\/.test(rest)) return rest
  if (rest.startsWith('UNC\\')) return `\\\\${rest.slice(4)}`
  return path
}
