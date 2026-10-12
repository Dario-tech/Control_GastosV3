// Regresión: detecta componentes JSX usados sin importar/declarar (ReferenceError en runtime).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')

function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

function undefinedTags(code) {
  const used = new Set([...code.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>.]/g)].map(m => m[1]))
  const defined = new Set()
  for (const m of code.matchAll(/import\s+([^'"]*?)\s+from\s+['"][^'"]+['"]/g)) {
    m[1].replace(/[{}]/g, ',').split(',').forEach(s => {
      const name = s.trim().split(/\s+as\s+/).pop().trim()
      if (name) defined.add(name)
    })
  }
  for (const m of code.matchAll(/(?:function|const|let|var|class)\s+([A-Z][A-Za-z0-9_]*)/g)) defined.add(m[1])
  return [...used].filter(n => !defined.has(n))
}

describe('componentes JSX: todo lo usado está importado', () => {
  const files = walk(SRC).filter(f => f.endsWith('.jsx'))
  it('hay ficheros que comprobar', () => expect(files.length).toBeGreaterThan(10))
  for (const f of files) {
    it(f.replace(SRC, 'src'), () => {
      expect(undefinedTags(readFileSync(f, 'utf8'))).toEqual([])
    })
  }
})
