import React from 'react'
import type { CodingSettingsProbe } from '@hermess/contracts'
import type { CodingSettingsController } from './useCodingSettings'

export default function ProgrammingMcpSettings({ controller: c, zh }: { controller: CodingSettingsController; zh: boolean }) {
  const [result, setResult] = React.useState<CodingSettingsProbe | null>(null)
  const rows = c.draft!.mcp_servers
  const authLabels: Record<string, string> = zh ? { unsupported: '无需 OAuth 授权', notLoggedIn: '需要授权', bearerToken: '令牌认证', oAuth: '已授权' } : { unsupported: 'OAuth not required', notLoggedIn: 'Authorization required', bearerToken: 'Token authentication', oAuth: 'Authorized' }
  return <>
    <p>{zh ? '此页只展示已配置的 MCP Servers。新增、启停和参数修改请编辑独立 config.toml，修改后重新读取并检查连接。' : 'This page lists configured MCP servers. Add, enable or configure servers in the separate config.toml, then reload and check connections.'}</p>
    <div className="programming-provider-actions"><button type="button" disabled={c.busy} onClick={() => void c.run(async () => { setResult(await c.api.coding.settingsProbe('')) })}>{zh ? '检查连接与工具' : 'Check connections and tools'}</button></div>
    {!rows.length && <p>{zh ? '尚未配置 MCP Server。' : 'No MCP servers configured.'}</p>}
    {rows.map(row => {
      const status = result?.servers.find(server => server.name === row.id)
      return <section className="programming-settings-fieldset" key={row.id}><strong>{row.id}</strong><p>{row.transport === 'stdio' ? 'STDIO' : 'HTTP'} · {row.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已禁用' : 'Disabled')}</p>
        {status ? <><p>{authLabels[status.authStatus] || (zh ? '认证状态未知' : 'Authentication status unknown')} · {status.toolsError ? (zh ? '工具发现失败，请检查配置或授权' : 'Tool discovery failed; check configuration or authorization') : (zh ? '可用工具：' : 'Available tools: ') + Object.keys(status.tools).length}</p><ul>{Object.keys(status.tools).map(tool => <li key={tool}>{tool}</li>)}</ul></> : <p>{zh ? '尚未检查连接' : 'Connection not checked'}</p>}
        {row.transport === 'http' && row.enabled && status?.authStatus === 'notLoggedIn' && <button type="button" disabled={c.busy} onClick={() => void c.run(async () => { setResult(await c.api.coding.settingsProbe('', row.id, true)) })}>{zh ? '浏览器授权' : 'Authorize in browser'}</button>}
      </section>
    })}
    {result && !result.success && <p className="programming-error" role="alert">{zh ? '部分连接未通过，请检查配置后重试。' : 'Some connections failed. Check configuration and retry.'}</p>}
  </>
}
