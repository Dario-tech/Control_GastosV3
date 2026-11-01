import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')

describe('PWA en iPhone: icono e imágenes de arranque', () => {
  it('declara apple-touch-icon y el fichero existe', () => {
    expect(html).toMatch(/rel="apple-touch-icon" href="\/pwa\/apple-touch-icon\.png"/)
    expect(existsSync(resolve(root, 'public/pwa/apple-touch-icon.png'))).toBe(true)
  })

  it('cada imagen de arranque referenciada existe y su nombre coincide con su tamaño', () => {
    const links = [...html.matchAll(/rel="apple-touch-startup-image" href="(\/pwa\/splash-(\d+)x(\d+)\.png)" media="([^"]+)"/g)]
    expect(links.length).toBeGreaterThanOrEqual(8)
    for (const [, href, w, h, media] of links) {
      expect(existsSync(resolve(root, 'public', href.slice(1)))).toBe(true)
      const dw = +media.match(/device-width: (\d+)px/)[1]
      const dh = +media.match(/device-height: (\d+)px/)[1]
      const r = +media.match(/pixel-ratio: (\d)/)[1]
      expect([dw * r, dh * r]).toEqual([+w, +h])
    }
  })
})
