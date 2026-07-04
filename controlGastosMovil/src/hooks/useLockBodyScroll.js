import { useEffect } from 'react'

export function useLockBodyScroll() {
  useEffect(() => {
    // iOS no respeta overflow:hidden en body — bloqueamos también el scroll de .main
    const main = document.querySelector('.main')
    const prevBody = document.body.style.overflow
    const prevMain = main?.style.overflow ?? ''

    document.body.style.overflow = 'hidden'
    if (main) main.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prevBody
      if (main) main.style.overflow = prevMain
    }
  }, [])
}
