import { describe, it, expect } from 'vitest'
import { detectInstallContext, installSteps } from '../src/utils/installContext'

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
}

describe('detectInstallContext', () => {
  it('distingue iPhone/Safari de iPhone/Chrome', () => {
    expect(detectInstallContext({ ua: UA.iosSafari })).toEqual({ platform: 'ios', browser: 'safari', installed: false })
    expect(detectInstallContext({ ua: UA.iosChrome })).toMatchObject({ platform: 'ios', browser: 'chrome' })
  })
  it('distingue Android por navegador', () => {
    expect(detectInstallContext({ ua: UA.androidChrome })).toMatchObject({ platform: 'android', browser: 'chrome' })
    expect(detectInstallContext({ ua: UA.androidFirefox })).toMatchObject({ platform: 'android', browser: 'firefox' })
    expect(detectInstallContext({ ua: UA.samsung })).toMatchObject({ platform: 'android', browser: 'samsung' })
  })
  it('reconoce iPadOS (se presenta como Mac) por los toques', () => {
    expect(detectInstallContext({ ua: UA.ipadOs, maxTouchPoints: 5 }).platform).toBe('ios')
    expect(detectInstallContext({ ua: UA.ipadOs, maxTouchPoints: 0 }).platform).toBe('other')
  })
  it('marca instalada cuando va en standalone', () => {
    expect(detectInstallContext({ ua: UA.iosSafari, standalone: true }).installed).toBe(true)
  })
})

describe('installSteps', () => {
  it('cada sistema tiene sus pasos', () => {
    expect(installSteps({ platform: 'ios', browser: 'safari' }).join(' ')).toMatch(/Compartir/)
    expect(installSteps({ platform: 'ios', browser: 'chrome' }).join(' ')).toMatch(/Safari/)
    expect(installSteps({ platform: 'android', browser: 'chrome' }).join(' ')).toMatch(/Instalar app/)
    expect(installSteps({ platform: 'android', browser: 'firefox' }).join(' ')).toMatch(/Instalar/)
    expect(installSteps({ platform: 'other', browser: 'other' }).length).toBe(1)
  })
})
