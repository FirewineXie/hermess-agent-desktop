export type DashboardPluginResponsePayload = {
  status: number
  status_text?: string
  content_type: string
  headers?: Record<string, string>
  body_base64: string
  url?: string
  redirected?: boolean
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function dashboardPluginResponse(payload: DashboardPluginResponsePayload) {
  const headers = new Headers(payload.headers)
  if (!headers.has('content-type')) headers.set('content-type', payload.content_type)
  const response = new Response(decodeBase64(payload.body_base64), {
    status: payload.status,
    statusText: payload.status_text || '',
    headers,
  })
  if (payload.url) Object.defineProperty(response, 'url', { value: payload.url })
  if (payload.redirected !== undefined) Object.defineProperty(response, 'redirected', { value: payload.redirected })
  return response
}
