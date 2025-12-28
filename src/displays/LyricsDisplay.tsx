import { useState, useEffect, useRef } from 'react'
import BackgroundRenderer, { BackgroundType } from '../backgrounds/BackgroundRenderer'

interface LyricSyllable {
  text: string
  time: number
}

interface LyricLine {
  text: string
  startTime: number
  endTime: number
  isMusicalBreak?: boolean
  syllables: LyricSyllable[]
}

interface PlaybackState {
  playing: boolean
  paused: boolean
  currentTime: number
  duration: number
  songName: string
  artist: string
  singer: string
  videoUrl?: string | null
}

interface QueueItem {
  singer_name: string
  title: string
  status: 'pending' | 'playing' | 'completed' | 'skipped'
}

type LyricsMode = 'normal' | 'bouncing'

export default function LyricsDisplay() {
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [currentLineIndex, setCurrentLineIndex] = useState(-1)
  const [currentTime, setCurrentTime] = useState(0) // in seconds
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>(() => {
    return (localStorage.getItem('lyricsMode') as LyricsMode) || 'normal'
  })
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    playing: false,
    paused: false,
    currentTime: 0,
    duration: 0,
    songName: '',
    artist: '',
    singer: ''
  })
  const [nextUp, setNextUp] = useState<QueueItem | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [wifiQrCode, setWifiQrCode] = useState<string | null>(null)
  const [showWifiQR, setShowWifiQR] = useState<boolean>(() => {
    return localStorage.getItem('showWifiQR') === 'true'
  })
  const [backgroundType, setBackgroundType] = useState<BackgroundType>(() => {
    const saved = localStorage.getItem('backgroundType') as BackgroundType
    // Migrate old 'youtube' setting to new system
    if (saved === 'youtube') {
      localStorage.setItem('backgroundType', 'none')
      localStorage.setItem('youtubeBackgroundEnabled', 'true')
      return 'none'
    }
    return saved || 'none'
  })
  const [backgroundVideoPath, setBackgroundVideoPath] = useState<string | null>(() => {
    return localStorage.getItem('backgroundVideoPath') || null
  })
  const [youtubeEnabled, setYoutubeEnabled] = useState<boolean>(() => {
    return localStorage.getItem('youtubeBackgroundEnabled') !== 'false' // Default to true
  })
  const containerRef = useRef<HTMLDivElement>(null)

  // Microphone audio analyser for visualizer
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)

  // Set up microphone input for visualizer
  useEffect(() => {
    let audioContext: AudioContext | null = null
    let stream: MediaStream | null = null

    const setupMicrophone = async () => {
      try {
        // Request microphone access
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        })

        // Create audio context and analyser
        audioContext = new AudioContext()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.3

        // Connect microphone to analyser
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        // Don't connect to destination - we don't want to play the mic back

        setAnalyserNode(analyser)
        console.log('Microphone connected to visualizer')
      } catch (error) {
        console.log('Microphone not available for visualizer:', error)
        // Visualizer will fall back to demo mode
      }
    }

    setupMicrophone()

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }
      if (audioContext) {
        audioContext.close()
      }
    }
  }, [])

  // Fetch QR codes on mount
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.getQRCode().then(setQrCode)
    window.electronAPI.getWifiQRCode().then(setWifiQrCode)
  }, [])

  // Listen for settings changes via IPC (cross-window communication)
  useEffect(() => {
    if (!window.electronAPI) return

    const unsubSettings = window.electronAPI.onSettingsChanged((data) => {
      if (data.key === 'showWifiQR') {
        setShowWifiQR(data.value === true || data.value === 'true')
      }
      if (data.key === 'lyricsMode') {
        setLyricsMode((data.value as LyricsMode) || 'normal')
      }
      if (data.key === 'backgroundType') {
        setBackgroundType((data.value as BackgroundType) || 'none')
      }
      if (data.key === 'backgroundVideoPath') {
        setBackgroundVideoPath(data.value as string | null)
      }
      if (data.key === 'youtubeBackgroundEnabled') {
        setYoutubeEnabled(data.value === true || data.value === 'true')
      }
    })

    return () => unsubSettings()
  }, [])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!window.electronAPI) return

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (playbackState.playing && !playbackState.paused) {
            await window.electronAPI.pause()
          } else {
            await window.electronAPI.play()
          }
          break
        case 'KeyN': // N for Next
        case 'ArrowRight':
          e.preventDefault()
          await window.electronAPI.skipCurrent()
          break
        case 'Escape':
          e.preventDefault()
          await window.electronAPI.stop()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playbackState.playing, playbackState.paused])

  useEffect(() => {
    if (!window.electronAPI) return

    // Subscribe to lyrics updates
    const unsubLyrics = window.electronAPI.onLyricsUpdate((data) => {
      const { lines, currentTime: time, currentLineIndex: lineIndex } = data as {
        lines: LyricLine[]
        currentTime: number
        currentLineIndex: number
      }
      setLyrics(lines)
      setCurrentLineIndex(lineIndex)
      setCurrentTime(time)
    })

    // Subscribe to playback updates
    const unsubPlayback = window.electronAPI.onPlaybackUpdate((state) => {
      setPlaybackState(state as PlaybackState)
    })

    // Subscribe to queue updates for "up next"
    const unsubQueue = window.electronAPI.onQueueUpdate((queue) => {
      const q = queue as QueueItem[]
      // Only show songs with 'pending' status as next up (not 'playing', 'completed', or 'skipped')
      const pending = q.filter((item) => item.status === 'pending')
      setNextUp(pending[0] || null)
    })

    return () => {
      unsubLyrics()
      unsubPlayback()
      unsubQueue()
    }
  }, [])

  // Scroll to keep current line centered
  useEffect(() => {
    if (containerRef.current && currentLineIndex >= 0) {
      const lineElements = containerRef.current.querySelectorAll('.lyrics-line')
      if (lineElements[currentLineIndex]) {
        lineElements[currentLineIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }
    }
  }, [currentLineIndex])

  const getLineClass = (index: number, line: LyricLine) => {
    const baseClass = line.isMusicalBreak ? 'lyrics-line musical-break' : 'lyrics-line'
    if (index < currentLineIndex) return `${baseClass} sung`
    if (index === currentLineIndex) return `${baseClass} current`
    return `${baseClass} upcoming`
  }

  // Render syllables with individual highlighting for the current line
  const renderSyllables = (line: LyricLine, lineIndex: number) => {
    // For musical breaks or lines without syllables, just render text
    if (line.isMusicalBreak || !line.syllables || line.syllables.length === 0) {
      return line.text
    }

    // For non-current lines, just show plain text (preserving the original text formatting)
    if (lineIndex !== currentLineIndex) {
      return line.text
    }

    // For the current line, highlight syllables based on timing
    return line.syllables.map((syllable, i) => {
      const isSung = currentTime >= syllable.time
      const isCurrentSyllable = isSung && (
        i === line.syllables.length - 1 || currentTime < line.syllables[i + 1].time
      )

      // Calculate ball progress for arc animation (0 to 1 within current syllable)
      let ballProgress = 0
      if (isCurrentSyllable && i < line.syllables.length - 1) {
        const syllableStart = syllable.time
        const syllableEnd = line.syllables[i + 1].time
        const syllableDuration = syllableEnd - syllableStart
        if (syllableDuration > 0) {
          ballProgress = Math.min(1, (currentTime - syllableStart) / syllableDuration)
        }
      }

      if (lyricsMode === 'bouncing') {
        // Bouncing ball mode: ball arcs between syllables
        // Use whitespace: pre-wrap to preserve spaces in syllables
        return (
          <span
            key={i}
            className="relative"
            style={{ whiteSpace: 'pre-wrap' }}
          >
            <span className={`transition-colors duration-100 ${
              isSung ? 'text-karaoke-current' : 'text-white/70'
            }`}>
              {syllable.text}
            </span>
            {isCurrentSyllable && (
              <span
                className="bouncing-ball-arc absolute text-2xl text-yellow-400 pointer-events-none"
                style={{
                  // Ball arcs from current syllable center towards next
                  // Horizontal: starts at 50%, moves to ~150% (next syllable)
                  left: `${50 + ballProgress * 100}%`,
                  // Vertical: parabolic arc - highest at middle of progress
                  top: `${-40 - Math.sin(ballProgress * Math.PI) * 20}px`,
                  transform: 'translateX(-50%)',
                  transition: 'none'
                }}
              >
                ●
              </span>
            )}
          </span>
        )
      }

      // Normal mode: color-based highlighting (preserve whitespace)
      return (
        <span
          key={i}
          className={`transition-colors duration-100 ${
            isSung ? 'text-karaoke-current' : 'text-white/70'
          }`}
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {syllable.text}
        </span>
      )
    })
  }

  // Determine effective background:
  // - If YouTube is enabled AND current song has a video URL, show YouTube
  // - Otherwise, show the selected fallback background type
  const hasYoutubeVideo = youtubeEnabled && playbackState.videoUrl
  const effectiveBackgroundType: BackgroundType = hasYoutubeVideo ? 'youtube' : backgroundType
  const youtubeUrl = hasYoutubeVideo ? playbackState.videoUrl : null

  // Debug logging for YouTube background
  if (youtubeEnabled && playbackState.playing) {
    console.log('Background:', { youtubeEnabled, hasVideo: !!playbackState.videoUrl, effectiveType: effectiveBackgroundType })
  }

  return (
    <div className="lyrics-container bg-karaoke-bg text-white overflow-hidden h-screen relative">
      {/* Background Layer */}
      <BackgroundRenderer
        type={effectiveBackgroundType}
        videoPath={effectiveBackgroundType === 'video' ? backgroundVideoPath : null}
        youtubeUrl={youtubeUrl}
        analyserNode={analyserNode}
      />

      {/* Semi-transparent overlay for readability when background is active */}
      {effectiveBackgroundType !== 'none' && (
        <div className="absolute inset-0 bg-black/40" style={{ zIndex: 1 }} />
      )}

      {/* Header with song info */}
      <div className="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/80 to-transparent z-20">
        <div className="flex items-center justify-between">
          <div>
            {playbackState.songName ? (
              <>
                <h1 className="text-3xl font-bold">{playbackState.songName}</h1>
                {playbackState.artist && (
                  <p className="text-xl text-gray-300">{playbackState.artist}</p>
                )}
                <p className="text-lg text-indigo-400 mt-1">
                  Singing: {playbackState.singer}
                </p>
              </>
            ) : (
              <h1 className="text-3xl font-bold text-gray-500">
                Waiting for song...
              </h1>
            )}
          </div>

          {/* QR Codes */}
          <div className="flex gap-4">
            {/* WiFi QR Code */}
            {showWifiQR && wifiQrCode && (
              <div className="bg-white p-3 rounded-lg">
                <img src={wifiQrCode} alt="WiFi QR Code" className="w-48 h-48" />
                <p className="text-sm text-gray-800 text-center mt-2">Scan for WiFi</p>
              </div>
            )}
            {/* Song Queue QR Code */}
            {qrCode && (
              <div className="bg-white p-3 rounded-lg">
                <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                <p className="text-sm text-gray-800 text-center mt-2">Scan to add songs</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lyrics area */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col items-center justify-center py-32 px-8 relative z-10"
      >
        {lyrics.length > 0 ? (
          // Show only 5 lines: 2 previous, current, 2 next
          lyrics
            .map((line, index) => ({ line, index }))
            .filter(({ index }) => {
              const current = currentLineIndex >= 0 ? currentLineIndex : 0
              return index >= current - 2 && index <= current + 2
            })
            .map(({ line, index }) => (
              <p key={index} className={getLineClass(index, line)}>
                {renderSyllables(line, index)}
              </p>
            ))
        ) : (
          <div className="text-center">
            <div className="text-6xl mb-8">&#127926;</div>
            <p className="text-2xl text-gray-500">No lyrics available</p>
          </div>
        )}
      </div>

      {/* Footer with next up */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent z-20">
        <div className="flex items-center justify-between">
          <div>
            {nextUp && (
              <div className="text-lg">
                <span className="text-gray-400">Up Next: </span>
                <span className="text-white font-medium">{nextUp.title}</span>
                <span className="text-indigo-400"> - {nextUp.singer_name}</span>
              </div>
            )}
          </div>

          {/* Playback status and keyboard hints */}
          <div className="flex items-center gap-6">
            <div className="text-xs text-gray-500">
              <span className="text-gray-400">Space</span> Play/Pause
              <span className="mx-2">|</span>
              <span className="text-gray-400">N</span> Skip
              <span className="mx-2">|</span>
              <span className="text-gray-400">Esc</span> Stop
            </div>
            {playbackState.playing && !playbackState.paused && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-400 text-sm">Playing</span>
              </div>
            )}
            {playbackState.paused && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <span className="text-yellow-400 text-sm">Paused</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
