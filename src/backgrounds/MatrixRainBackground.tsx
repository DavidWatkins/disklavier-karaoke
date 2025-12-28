import { useEffect, useRef } from 'react'

export default function MatrixRainBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  const dropsRef = useRef<number[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Cancel any existing animation
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    // Characters to use (mix of Latin, numbers, and Japanese katakana)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'
    const fontSize = 16

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      // Reinitialize drops on resize
      const columns = Math.floor(canvas.width / fontSize)
      dropsRef.current = Array(columns).fill(1)
    }
    resize()
    window.addEventListener('resize', resize)

    // Initialize drops
    const columns = Math.floor(canvas.width / fontSize)
    dropsRef.current = Array(columns).fill(1)

    // Speed: rows per millisecond
    const speed = 0.05
    // Accumulator for sub-pixel movement
    const accumulators = Array(columns).fill(0)

    const animate = (currentTime: number) => {
      // Calculate delta time
      const deltaTime = lastTimeRef.current ? currentTime - lastTimeRef.current : 16
      lastTimeRef.current = currentTime

      // Cap delta time to prevent huge jumps
      const cappedDelta = Math.min(deltaTime, 100)

      // Semi-transparent black to create fade effect
      ctx.fillStyle = 'rgba(10, 10, 26, 0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.font = `${fontSize}px monospace`

      const drops = dropsRef.current

      for (let i = 0; i < drops.length; i++) {
        // Accumulate movement
        accumulators[i] += speed * cappedDelta

        // Only move when we've accumulated at least 1 row
        if (accumulators[i] >= 1) {
          const rowsToMove = Math.floor(accumulators[i])
          accumulators[i] -= rowsToMove

          // Random character
          const char = chars[Math.floor(Math.random() * chars.length)]
          const x = i * fontSize
          const y = drops[i] * fontSize

          // Varying brightness - occasionally very bright (leading character)
          const isLeading = Math.random() > 0.98
          if (isLeading) {
            ctx.fillStyle = '#fff'
          } else {
            const brightness = 100 + Math.random() * 155
            ctx.fillStyle = `rgb(0, ${brightness}, 0)`
          }

          ctx.fillText(char, x, y)

          // Reset drop to top randomly after reaching bottom
          if (y > canvas.height && Math.random() > 0.975) {
            drops[i] = 0
          }
          drops[i] += rowsToMove
        }
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 0 }}
    />
  )
}
