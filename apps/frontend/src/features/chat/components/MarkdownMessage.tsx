import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import LocalPreview from './LocalPreview'

const remarkPlugins = [remarkGfm]
type Language = 'zh-CN' | 'en-US'

function safeUrl(url: string, key: string) {
  if (key !== 'href') return ''
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''
  } catch {
    return ''
  }
}

function plainText(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(plainText).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(value)) return plainText(value.props.children)
  return ''
}

function CodeBlock({ children, language }: { children?: React.ReactNode; language: Language }) {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const copyLabels = language === 'zh-CN'
    ? { idle: '复制代码', copied: '已复制', failed: '复制失败' }
    : { idle: 'Copy code', copied: 'Copied', failed: 'Copy failed' }
  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText(children).replace(/\n$/, ''))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return <div className="markdown-code-block">
    <button type="button" className="markdown-copy" onClick={() => void copy()}>{copyLabels[copyState]}</button>
    <pre>{children}</pre>
  </div>
}

function MarkdownMessage({ text, language }: { text: string; language: Language }) {
  const parts: Array<{ kind: 'markdown'; value: string } | { kind: 'preview'; value: string }> = []
  let markdown = ''
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced
    const directive = !fenced && line.trim().match(/^::preview\{file="([^"\r\n]+)"\}$/)
    if (directive) {
      if (markdown.trim()) parts.push({ kind: 'markdown', value: markdown })
      parts.push({ kind: 'preview', value: directive[1] })
      markdown = ''
    } else markdown += `${line}\n`
  }
  if (markdown.trim()) parts.push({ kind: 'markdown', value: markdown })
  return <div className="markdown-body">{parts.map((part, index) => part.kind === 'preview'
    ? <LocalPreview key={`${index}-${part.value}`} path={part.value} language={language} />
    : <ReactMarkdown key={index} remarkPlugins={remarkPlugins} skipHtml urlTransform={safeUrl} components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="markdown-image-alt">{language === 'zh-CN' ? `[图片：${alt || '未提供说明'}]` : `[Image: ${alt || 'no description'}]`}</span>,
      pre: ({ children }) => <CodeBlock language={language}>{children}</CodeBlock>,
      table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
    }}>{part.value}</ReactMarkdown>)}
  </div>
}

export default React.memo(MarkdownMessage)
