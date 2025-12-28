import { useEffect, useRef } from 'react'

interface Props {
  analyserNode?: AnalyserNode | null
}

export default function CircularVisualizerBackground({ analyserNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)

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

    // Frequency data buffer
    const bufferLength = analyserNode?.frequencyBinCount || 128
    const dataArray = new Uint8Array(bufferLength)

    const animate = () => {
      const width = canvas.width
      const height = canvas.height
      const centerX = width / 2
      const centerY = height / 2
      const radius = Math.min(width, height) * 0.25

      // Clear canvas with dark background
      ctx.fillStyle = '#0a0a1a'
      ctx.fillRect(0, 0, width, height)

      // Get frequency data from microphone analyser
      if (analyserNode) {
        analyserNode.getByteFrequencyData(dataArray)
      } else {
        // Demo mode: generate ambient visual effect when mic not available
        const time = Date.now() / 1000
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = Math.floor(
            40 +
            Math.sin(time * 0.5 + i * 0.1) * 20 +
            Math.sin(time * 0.8 + i * 0.15) * 15
          )
        }
      }

      // Number of bars around the circle
      const barCount = 180
      const barWidth = (2 * Math.PI * radius) / barCount * 0.6

      // Draw the circular visualizer
      for (let i = 0; i < barCount; i++) {
        // Map bar index to frequency bin (use lower frequencies more)
        const freqIndex = Math.floor(Math.pow(i / barCount, 1.5) * (bufferLength * 0.7))
        const value = dataArray[freqIndex] || 0

        // Calculate bar height based on frequency value
        const barHeight = (value / 255) * radius * 0.8 + 2

        // Angle for this bar
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2

        // Calculate start and end points
        const x1 = centerX + Math.cos(angle) * radius
        const y1 = centerY + Math.sin(angle) * radius
        const x2 = centerX + Math.cos(angle) * (radius + barHeight)
        const y2 = centerY + Math.sin(angle) * (radius + barHeight)

        // Color based on frequency (low = purple, mid = cyan, high = pink)
        const hue = 260 + (i / barCount) * 60
        const saturation = 70 + (value / 255) * 30
        const lightness = 50 + (value / 255) * 20

        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
        ctx.lineWidth = barWidth
        ctx.lineCap = 'round'
        ctx.stroke()
      }

      // Draw inner glow circle
      const gradient = ctx.createRadialGradient(
        centerX, centerY, radius * 0.5,
        centerX, centerY, radius
      )
      gradient.addColorStop(0, 'rgba(100, 50, 150, 0.1)')
      gradient.addColorStop(1, 'rgba(100, 50, 150, 0)')

      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      // Draw center circle outline
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.lineWidth = 2
      ctx.stroke()

      // Add subtle outer glow based on average volume
      const avgVolume = dataArray.reduce((a, b) => a + b, 0) / bufferLength
      const glowRadius = radius + (avgVolume / 255) * radius * 0.3

      const outerGlow = ctx.createRadialGradient(
        centerX, centerY, radius,
        centerX, centerY, glowRadius + 50
      )
      outerGlow.addColorStop(0, `rgba(150, 100, 200, ${avgVolume / 255 * 0.3})`)
      outerGlow.addColorStop(1, 'rgba(150, 100, 200, 0)')

      ctx.beginPath()
      ctx.arc(centerX, centerY, glowRadius + 50, 0, Math.PI * 2)
      ctx.fillStyle = outerGlow
      ctx.fill()

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
  }, [analyserNode])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 0 }}
    />
  )
}
