import { useEffect, useRef } from 'react'

const DURATION = 520

type Point = { u: number; v: number }

export default function Crumple({
  active,
  target,
  onDone,
}: {
  active: boolean
  target: HTMLElement | null
  onDone: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active || !target) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = target.getBoundingClientRect()
    const parent = target.offsetParent as HTMLElement | null
    const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 }
    const left = rect.left - parentRect.left
    const top = rect.top - parentRect.top
    const width = rect.width
    const height = rect.height

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.left = `${left}px`
    canvas.style.top = `${top}px`
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // Resolve the paper and line colours from CSS so the crumple follows the
    // active theme instead of always rendering a white sheet.
    const resolveColor = (name: string, fallback: string): [number, number, number] => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
      const probe = document.createElement('canvas')
      const pctx = probe.getContext('2d')
      if (!pctx) return [247, 249, 250]
      pctx.fillStyle = raw
      pctx.fillRect(0, 0, 1, 1)
      const data = pctx.getImageData(0, 0, 1, 1).data
      return [data[0], data[1], data[2]]
    }
    const paper = resolveColor('--paper', '#F7F9FA')
    const pencil = resolveColor('--pencil', '#2F4BFF')
    const ink = resolveColor('--ink', '#1B2328')

    // Build mesh
    const COLS = 22
    const ROWS = 14
    const pts: Point[] = []
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        pts.push({ u: c / COLS, v: r / ROWS })
      }
    }
    const idx = (c: number, r: number) => r * (COLS + 1) + c

    // Folds
    const folds: { ang: number; off: number; str: number }[] = []
    const foldCount = 7
    for (let i = 0; i < foldCount; i++) {
      folds.push({
        ang: Math.random() * Math.PI,
        off: (Math.random() - 0.5) * 0.6,
        str: 0.35 + Math.random() * 0.5,
      })
    }

    const jitter = pts.map(() => ({
      x: (Math.random() - 0.5) * 0.04,
      y: (Math.random() - 0.5) * 0.04,
    }))

    function foldPoint(u: number, v: number, t: number) {
      let x = u
      let y = v
      let z = 0
      for (const f of folds) {
        const nx = Math.cos(f.ang)
        const ny = Math.sin(f.ang)
        const d = (x - 0.5) * nx + (y - 0.5) * ny - f.off
        if (d < 0) {
          const foldAmt = (1 - Math.exp(-t * 3.2)) * f.str
          x -= nx * d * foldAmt * 2
          y -= ny * d * foldAmt * 2
          z += Math.abs(d) * foldAmt * 0.6
        }
      }
      const cx = 0.5
      const cy = 0.5
      const comp = 1 - (1 - Math.exp(-t * 2.4)) * 0.55
      x = cx + (x - cx) * comp
      y = cy + (y - cy) * comp
      return { x, y, z }
    }

    function toScreen(p: { x: number; y: number }) {
      return { x: p.x * width, y: p.y * height }
    }

    let raf = 0
    const start = performance.now()
    let done = false

    function frame(now: number) {
      const elapsed = now - start
      const t = Math.min(1, elapsed / DURATION)
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

      const pos = pts.map((p, i) => {
        const r = foldPoint(p.u, p.v, e)
        const j = jitter[i]
        return {
          x: r.x + j.x * e,
          y: r.y + j.y * e,
          z: r.z,
        }
      })

      ctx.clearRect(0, 0, width, height)

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i0 = idx(c, r)
          const i1 = idx(c + 1, r)
          const i2 = idx(c, r + 1)
          const i3 = idx(c + 1, r + 1)
          for (const tri of [
            [i0, i1, i2],
            [i1, i3, i2],
          ]) {
            const a = toScreen(pos[tri[0]])
            const b = toScreen(pos[tri[1]])
            const cc = toScreen(pos[tri[2]])
            const zavg = (pos[tri[0]].z + pos[tri[1]].z + pos[tri[2]].z) / 3
            const shade = Math.max(0.55, 1 - zavg * 0.9)
            const light = 0.85 + zavg * 0.4
            const rcol = Math.round(paper[0] * shade * light)
            const gcol = Math.round(paper[1] * shade * light)
            const bcol = Math.round(paper[2] * shade * light)
            ctx.fillStyle = `rgb(${rcol},${gcol},${bcol})`
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.lineTo(cc.x, cc.y)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = `rgba(${pencil[0]},${pencil[1]},${pencil[2]},${0.06 + zavg * 0.12})`
            ctx.lineWidth = 0.6
            ctx.stroke()
          }
        }
      }

      // outline
      ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.35)`
      ctx.lineWidth = 1
      const border: number[] = []
      for (let c = 0; c <= COLS; c++) border.push(idx(c, 0))
      for (let r = 1; r <= ROWS; r++) border.push(idx(COLS, r))
      for (let c = COLS - 1; c >= 0; c--) border.push(idx(c, ROWS))
      for (let r = ROWS - 1; r >= 1; r--) border.push(idx(0, r))
      ctx.beginPath()
      border.forEach((i, k) => {
        const p = toScreen(pos[i])
        if (k === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.stroke()

      if (t < 1) {
        raf = requestAnimationFrame(frame)
      } else if (!done) {
        done = true
        onDone()
      }
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [active, target, onDone])

  if (!active) return null
  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', pointerEvents: 'none', zIndex: 5 }}
    />
  )
}
