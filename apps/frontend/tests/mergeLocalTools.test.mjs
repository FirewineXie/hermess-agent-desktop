import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeLocalTools } from '../src/features/tools/mergeLocalTools.ts'

test('merges bundled, optional and PATH sources without duplicate FFmpeg rows', () => {
  const bundled = { has_manifest: true, tools: [{ name: 'ffmpeg', version: '9.0.1', path: '/runtime/ffmpeg', present: true }] }
  const downloadable = [{ name: 'ffmpeg', version: '9.0.1', installed: false, supported: true }, { name: 'gh', version: '2.97.0', installed: false, supported: true }]
  const probes = [
    { tool: 'FFmpeg', kind: 'command', path: '/usr/bin/ffmpeg', version: 'ffmpeg version 9', usable: true, reason: '' },
    { tool: 'FFprobe', kind: 'command', path: '/usr/bin/ffprobe', version: 'ffprobe version 9', usable: true, reason: '' },
    { tool: 'GitHub CLI', kind: 'command', path: '/usr/bin/gh', version: 'gh version 2', usable: true, reason: '' },
  ]
  const rows = mergeLocalTools(bundled, downloadable, probes)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.find(row => row.key === 'ffmpeg')?.companions.map(probe => probe.tool), ['FFprobe'])
  assert.equal(rows.find(row => row.key === 'ffmpeg')?.system?.tool, 'FFmpeg')
  assert.equal(rows.find(row => row.key === 'ffmpeg')?.bundled?.path, '/runtime/ffmpeg')
  assert.equal(rows.find(row => row.key === 'gh')?.system?.tool, 'GitHub CLI')
})
