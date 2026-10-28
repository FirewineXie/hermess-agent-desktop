import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), {
    name: 'obfuscate-desktop-javascript',
    apply: 'build',
    renderChunk(code) {
      const obfuscated = JavaScriptObfuscator.obfuscate(code, {
        target: 'browser',
        compact: true,
        identifierNamesGenerator: 'hexadecimal',
        seed: 1,
        stringArray: true,
        stringArrayThreshold: 0.3,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        renameGlobals: false,
        renameProperties: false,
        selfDefending: false,
        sourceMap: false,
      }).getObfuscatedCode()
      if (obfuscated === code) throw new Error('Desktop JavaScript was not obfuscated')
      return {
        code: obfuscated,
        map: null,
      }
    },
  }],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { sourcemap: false, rollupOptions: { input: { main: resolve(__dirname, 'index.html'), quickEntry: resolve(__dirname, 'quick-entry.html') } } },
})
