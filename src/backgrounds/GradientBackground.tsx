import { useEffect, useRef } from 'react'

export default function GradientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const timeRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)

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

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Speed: time units per millisecond
    const speed = 0.0002

    const animate = (currentTime: number) => {
      // Calculate delta time
      const deltaTime = lastTimeRef.current ? currentTime - lastTimeRef.current : 16
      lastTimeRef.current = currentTime

      // Cap delta time to prevent huge jumps
      const cappedDelta = Math.min(deltaTime, 100)

      // Update time (delta-time based)
      timeRef.current += speed * cappedDelta
      const time = timeRef.current

      // Create slowly shifting gradient colors in purple/blue/pink range
      const hue1 = (Math.sin(time) * 30 + 260) % 360        // Purple
      const hue2 = (Math.cos(time * 0.7) * 30 + 300) % 360  // Pink
      const hue3 = (Math.sin(time * 0.5) * 30 + 220) % 360  // Blue

      // Moving center point for radial gradient
      const centerX = canvas.width * (0.5 + Math.sin(time * 0.5) * 0.3)
      const centerY = canvas.height * (0.5 + Math.cos(time * 0.7) * 0.3)

      const gradient = ctx.createRadialGradient(
        centerX, centerY, 0,
        canvas.width / 2, canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.8
      )

      gradient.addColorStop(0, `hsla(${hue1}, 70%, 20%, 1)`)
      gradient.addColorStop(0.4, `hsla(${hue2}, 60%, 12%, 1)`)
      gradient.addColorStop(0.7, `hsla(${hue3}, 50%, 8%, 1)`)
      gradient.addColorStop(1, `hsla(240, 40%, 5%, 1)`)

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Add subtle noise/texture (only on every few frames for performance)
      if (Math.random() > 0.7) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        for (let i = 0; i < data.length; i += 16) { // Skip pixels for performance
          const noise = (Math.random() - 0.5) * 8
          data[i] += noise     // R
          data[i + 1] += noise // G
          data[i + 2] += noise // B
        }
        ctx.putImageData(imageData, 0, 0)
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
