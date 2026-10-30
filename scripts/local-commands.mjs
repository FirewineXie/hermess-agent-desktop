import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const build = resolve(root, '.build')
const payload = resolve(build, 'payload')
const devPython = resolve(build, 'hermes-venv-i1', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const pnpmCli = process.env.npm_execpath

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function pnpm(...args) {
  if (!pnpmCli) throw new Error('请通过 pnpm 运行本命令')
  run(process.execPath, [pnpmCli, ...args])
}

function python() {
  const candidates = [
    ...(process.env.HERMESS_PYTHON ? [[process.env.HERMESS_PYTHON]] : []),
    ...(process.platform === 'win32' ? [['py', '-3.14']] : []),
    ['python3.14'], ['python'],
    ...(existsSync(devPython) ? [[devPython]] : []),
  ]
  for (const [command, ...prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '-c',
      'import platform,sys; print(sys.executable if sys.version_info[:2] == (3, 14) and platform.python_implementation() == "CPython" else "")'],
    { cwd: root, encoding: 'utf8', timeout: 10000 })
    const executable = result.status === 0 ? result.stdout.trim() : ''
    if (executable && existsSync(executable)) return executable
  }
  throw new Error('未找到 CPython 3.14；请安装它，或设置 HERMESS_PYTHON 为解释器绝对路径')
}

const command = process.argv[2]
const target = {
  'pack-win': ['win32', 'x64'],
  'pack-mac': ['darwin', null],
  'pack-linux': ['linux', 'x64'],
}[command]

if (command === 'deps') {
  mkdirSync(build, { recursive: true })
  run(process.execPath, ['scripts/fetch-upstream.mjs'])
  pnpm('install', '--frozen-lockfile')
  run('cargo', ['fetch', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'])
  const interpreter = python()
  if (!existsSync(devPython)) {
    if (existsSync(resolve(build, 'hermes-venv-i1'))) {
      throw new Error('.build/hermes-venv-i1 已存在但缺少 Python，请检查该目录后重试')
    }
    run(interpreter, ['scripts/prepare-python.py', '--python', interpreter,
      '--out', resolve(build, 'hermes-venv-i1')])
  }
  if (!existsSync(payload)) {
    run(interpreter, ['scripts/build-core-payload.py', '--out', payload])
  } else {
    run(interpreter, ['scripts/verify-payload.py', '--payload', payload])
  }
  console.log('依赖、开发环境和离线载荷已准备好')
} else if (target) {
  const [platform, arch] = target
  if (process.platform !== platform || (arch && process.arch !== arch) ||
      (platform === 'darwin' && !['arm64', 'x64'].includes(process.arch))) {
    throw new Error(`${command} 必须在对应架构的 ${platform} 机器上运行；当前为 ${process.platform}-${process.arch}`)
  }
  if (!existsSync(payload)) throw new Error('缺少离线载荷，请先运行 pnpm deps')
  const env = platform === 'darwin' ? { ...process.env, APPLE_SIGNING_IDENTITY: '-' } : process.env
  run(python(), ['scripts/build-offline-runtime.py', '--payload', payload, '--build'], { env })
} else {
  throw new Error('可用命令：pnpm deps、pnpm pack:win、pnpm pack:mac、pnpm pack:linux')
}
