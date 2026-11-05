export const PREVIEW_LOAD_MESSAGE = 'hermess-preview-load'
export const PREVIEW_READY_MESSAGE = 'hermess-preview-ready'
export const PREVIEW_RESIZE_MESSAGE = 'hermess-preview-resize'
export const PREVIEW_ERROR_MESSAGE = 'hermess-preview-error'

export type PreviewTheme = Record<'foreground' | 'mutedForeground' | 'accent' | 'border' | 'card' | 'font', string>

export function htmlPreviewSandbox(token: string): string {
  if (!/^[a-z\d-]+$/i.test(token)) throw new Error('Invalid preview token')
  const csp = [
    "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
    'img-src data: blob:', 'media-src data: blob:', 'font-src data:', "connect-src 'none'",
    "frame-src 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'",
    "form-action 'none'", "navigate-to 'none'",
  ].join('; ')
  return `<!doctype html><html><head>
<meta charset="utf-8" data-hermess-shell>
<meta http-equiv="Content-Security-Policy" content="${csp}" data-hermess-shell>
<meta name="viewport" content="width=device-width,initial-scale=1" data-hermess-shell>
<style data-hermess-shell>:root{color-scheme:light dark}html,body{max-width:100%;min-height:1px;margin:0;overflow-x:hidden}body{color:var(--foreground);font-family:var(--app-font);background:transparent}</style>
</head><body><script data-hermess-shell>
(() => {
  'use strict'
  const token = ${JSON.stringify(token)}
  const send = (type, detail = {}) => parent.postMessage({ type, token, ...detail }, '*')
  const reportSize = () => send('${PREVIEW_RESIZE_MESSAGE}', { height: Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)) })
  const observer = new ResizeObserver(reportSize)
  observer.observe(document.documentElement)
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    if (link) event.preventDefault()
  }, true)
  document.addEventListener('submit', event => event.preventDefault(), true)

  function activateScripts(root) {
    for (const oldScript of root.querySelectorAll('script:not([data-hermess-shell])')) {
      if (oldScript.hasAttribute('src')) { oldScript.remove(); continue }
      const script = document.createElement('script')
      for (const { name, value } of oldScript.attributes) if (name !== 'src') script.setAttribute(name, value)
      script.textContent = oldScript.textContent
      oldScript.replaceWith(script)
    }
  }

  function install(html, theme) {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    parsed.querySelectorAll('base,meta[http-equiv],link,iframe,frame,object,embed').forEach(node => node.remove())
    document.head.querySelectorAll(':scope > :not([data-hermess-shell])').forEach(node => node.remove())
    for (const node of [...parsed.head.childNodes]) document.head.append(document.importNode(node, true))
    document.body.replaceChildren(...[...parsed.body.childNodes].map(node => document.importNode(node, true)))
    document.documentElement.lang = parsed.documentElement.lang || ''
    for (const [name, value] of Object.entries(theme || {})) {
      const cssName = name === 'mutedForeground' ? '--muted-foreground' : name === 'font' ? '--app-font' : '--' + name
      document.documentElement.style.setProperty(cssName, String(value))
    }
    activateScripts(document.head)
    activateScripts(document.body)
    requestAnimationFrame(() => { reportSize(); send('${PREVIEW_READY_MESSAGE}') })
  }

  addEventListener('message', event => {
    const data = event.data
    if (event.source !== parent || !data || data.type !== '${PREVIEW_LOAD_MESSAGE}' || data.token !== token || typeof data.html !== 'string') return
    try { install(data.html, data.theme) } catch { send('${PREVIEW_ERROR_MESSAGE}') }
  })
})()
</script></body></html>`
}
