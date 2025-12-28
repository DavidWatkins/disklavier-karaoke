/**
 * CDG Renderer Component
 *
 * Renders CDG graphics to a canvas and plays the associated audio.
 * The CDG frames are received from the main process via IPC.
 */

import { useRef, useEffect, useState, useCallback } from 'react'

// CDG display dimensions (visible area without borders)
const CDG_WIDTH = 288
const CDG_HEIGHT = 192

interface CdgRendererProps {
  songId: number
  audioPath: string
  playing: boolean
  paused: boolean
  onTimeUpdate?: (timeMs: number) => void
  onEnded?: () => void
}

interface CdgFrameData {
  width: number
  height: number
  rgba: number[] // Uint8ClampedArray serialized as array
  timestamp: number
}

export default function CdgRenderer({
  songId,
  audioPath: _audioPath, // Used for type checking, actual audio comes from API
  playing,
  paused,
  onTimeUpdate,
  onEnded
}: CdgRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Set up audio source
  useEffect(() => {
    if (!audioRef.current) return

    // Audio is served from the web server
    const audioUrl = `/api/audio/${songId}`
    audioRef.current.src = audioUrl
    audioRef.current.load()

    const handleCanPlay = () => {
      setIsLoading(false)
      setError(null)
    }

    const handleError = () => {
      setIsLoading(false)
      setError('Failed to load audio')
    }

    audioRef.current.addEventListener('canplay', handleCanPlay)
    audioRef.current.addEventListener('error', handleError)

    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('canplay', handleCanPlay)
        audioRef.current.removeEventListener('error', handleError)
      }
    }
  }, [songId])

  // Handle play/pause state
  useEffect(() => {
    if (!audioRef.current || isLoading) return

    if (playing && !paused) {
      audioRef.current.play().catch(console.error)
    } else {
      audioRef.current.pause()
    }
  }, [playing, paused, isLoading])

  // Handle audio time updates
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      const timeMs = audio.currentTime * 1000
      onTimeUpdate?.(timeMs)
    }

    const handleEnded = () => {
      onEnded?.()
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [onTimeUpdate, onEnded])

  // Render CDG frame to canvas
  const renderFrame = useCallback((frameData: CdgFrameData) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Convert array back to Uint8ClampedArray
    const rgba = new Uint8ClampedArray(frameData.rgba)
    const imageData = new ImageData(rgba, frameData.width, frameData.height)

    // Draw to canvas
    ctx.putImageData(imageData, 0, 0)
  }, [])

  // Listen for CDG frame updates from main process
  useEffect(() => {
    // TODO: Set up IPC listener for CDG frames
    // For now, we'll rely on the main process to send frames
    // The actual implementation would be:
    //
    // const unsubFrame = window.electronAPI?.onCdgFrame?.(renderFrame)
    // return () => unsubFrame?.()
    //
    // This requires adding the IPC handler to preload.ts

    // For testing, fill canvas with a placeholder
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, CDG_WIDTH, CDG_HEIGHT)
        ctx.fillStyle = '#444'
        ctx.font = '16px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('CDG Display', CDG_WIDTH / 2, CDG_HEIGHT / 2)
      }
    }
  }, [renderFrame])

  return (
    <div className="cdg-renderer flex flex-col items-center justify-center h-full">
      {/* CDG Canvas - scaled up for display */}
      <div className="relative" style={{ transform: 'scale(2.5)', transformOrigin: 'center' }}>
        <canvas
          ref={canvasRef}
          width={CDG_WIDTH}
          height={CDG_HEIGHT}
          className="bg-black rounded shadow-2xl"
          style={{
            imageRendering: 'pixelated' // Preserve pixel art look
          }}
        />

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white text-sm">Loading...</div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-red-400 text-sm">{error}</div>
          </div>
        )}
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" />
    </div>
  )
}
