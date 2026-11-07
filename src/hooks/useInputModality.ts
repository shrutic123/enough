import { useEffect } from 'react'

/**
 * Track how the user is interacting. Some browsers keep the focus ring suppressed
 * after a pointer click even once the user starts tabbing; forcing the ring on
 * after keyboard input makes the focus state predictable everywhere.
 */
export function useInputModality(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return

    function setModality(next: 'keyboard' | 'pointer') {
      document.documentElement.dataset.input = next
    }

    function onPointerDown() {
      setModality('pointer')
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '' || event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift') {
        return
      }
      setModality('keyboard')
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
