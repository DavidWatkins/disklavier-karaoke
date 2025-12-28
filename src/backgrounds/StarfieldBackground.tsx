import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  z: number
}

export default function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<Star[]>([])
  const animationRef = useRef<number | null>(null)
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

    // Initialize stars
    const numStars = 500
    starsRef.current = Array.from({ length: numStars }, () => ({
      x: Math.random() * canvas.width - canvas.width / 2,
      y: Math.random() * canvas.height - canvas.height / 2,
      z: Math.random() * 1000
    }))

    // Speed: pixels per millisecond
    const speed = 0.5

    const animate = (currentTime: number) => {
      // Calculate delta time
      const deltaTime = lastTimeRef.current ? currentTime - lastTimeRef.current : 16
      lastTimeRef.current = currentTime

      // Cap delta time to prevent huge jumps (e.g., when tab is backgrounded)
      const cappedDelta = Math.min(deltaTime, 100)

      // Fade trail effect
      ctx.fillStyle = 'rgba(10, 10, 26, 0.2)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      starsRef.current.forEach(star => {
        // Move star toward camera (delta-time based)
        star.z -= speed * cappedDelta

        // Reset star when it passes camera
        if (star.z <= 0) {
          star.x = Math.random() * canvas.width - centerX
          star.y = Math.random() * canvas.height - centerY
          star.z = 1000
        }

        // Project 3D to 2D
        const sx = (star.x / star.z) * 300 + centerX
        const sy = (star.y / star.z) * 300 + centerY

        // Size and brightness based on distance
        const size = Math.max(0, (1 - star.z / 1000) * 3)
        const brightness = 1 - star.z / 1000

        // Draw star
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`
        ctx.arc(sx, sy, size, 0, Math.PI * 2)
        ctx.fill()

        // Draw streak for close stars
        if (star.z < 200) {
          const prevZ = star.z + 15
          const prevSx = (star.x / prevZ) * 300 + centerX
          const prevSy = (star.y / prevZ) * 300 + centerY

          ctx.beginPath()
          ctx.strokeStyle = `rgba(255, 255, 255, ${brightness * 0.5})`
          ctx.lineWidth = size * 0.5
          ctx.moveTo(prevSx, prevSy)
          ctx.lineTo(sx, sy)
          ctx.stroke()
        }
      })

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
