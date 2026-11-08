import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseTranscriptParts, type TranscriptDirective } from '../transcriptParts'
import { isFileLink, isMediaSource, mediaSource, pendingMarkdownMedia } from '../mediaModel'
import MediaAttachment from './MediaAttachment'
import DirectivePreview from './DirectivePreview'

const remarkPlugins = [remarkGfm]
type Language = 'zh-CN' | 'en-US'
type DirectiveRenderer = (directive: TranscriptDirective, language: Language) => React.ReactNode

const directiveRenderers: Record<string, DirectiveRenderer> = {
  preview: ({ attrs }, language) => attrs.file ? <DirectivePreview path={attrs.file} language={language} /> : null,
}
const supportedDirectives = new Set(Object.keys(directiveRenderers))

function safeUrl(url: string, key: string) {
  if (mediaSource(url) || isMediaSource(url)) return url
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

function MarkdownMessage({ text, language, streaming = false }: { text: string; language: Language; streaming?: boolean }) {
  const parts = parseTranscriptParts(text, supportedDirectives, streaming)
  return <div className="markdown-body">{parts.map((part, index) => part.kind === 'directive'
    ? <React.Fragment key={`${index}-${part.name}`}>{directiveRenderers[part.name]?.(part, language)}</React.Fragment>
    : <ReactMarkdown key={index} remarkPlugins={remarkPlugins} skipHtml urlTransform={safeUrl} components={{
      a: ({ href, children, node }) => {
        const source = href && mediaSource(href)
        if (source || (href && isFileLink(href))) {
          if (pendingMarkdownMedia(part.value, node?.position?.start.offset, node?.position?.end.offset, streaming && index === parts.length - 1 && !text.endsWith('\n'))) return <span>{children}</span>
          return <MediaAttachment source={source || href!} label={plainText(children)} language={language} />
        }
        return href && /^https?:/i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
      },
      img: ({ src, alt, node }) => typeof src === 'string' && src && !pendingMarkdownMedia(part.value, node?.position?.start.offset, node?.position?.end.offset, streaming && index === parts.length - 1 && !text.endsWith('\n')) ? <MediaAttachment source={src} label={alt} language={language} /> : <span className="markdown-image-alt">{language === 'zh-CN' ? `[图片：${alt || '未提供说明'}]` : `[Image: ${alt || 'no description'}]`}</span>,
      pre: ({ children }) => <CodeBlock language={language}>{children}</CodeBlock>,
      table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
    }}>{part.value}</ReactMarkdown>)}
  </div>
}

export default React.memo(MarkdownMessage)
