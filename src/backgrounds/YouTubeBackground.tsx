import { useMemo } from 'react'

interface Props {
  url: string
}

function extractVideoId(url: string): string | null {
  // Handle various YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\?\/]+)/,           // youtube.com/watch?v=ID
    /(?:youtu\.be\/)([^&\?\/]+)/,                        // youtu.be/ID
    /(?:youtube\.com\/embed\/)([^&\?\/]+)/,              // youtube.com/embed/ID
    /(?:youtube\.com\/v\/)([^&\?\/]+)/,                  // youtube.com/v/ID
    /(?:youtube\.com\/shorts\/)([^&\?\/]+)/,             // youtube.com/shorts/ID
    /^([a-zA-Z0-9_-]{11})$/                              // Direct video ID
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

export default function YouTubeBackground({ url }: Props) {
  console.log('YouTubeBackground rendering with url:', url)

  const videoId = useMemo(() => extractVideoId(url), [url])

  console.log('YouTubeBackground extracted videoId:', videoId)

  if (!videoId) {
    console.warn('Could not extract YouTube video ID from:', url)
    return null
  }

  // YouTube embed URL with parameters for background usage:
  // autoplay=1 - start playing immediately
  // mute=1 - muted (required for autoplay)
  // loop=1 - loop the video
  // playlist=ID - required for loop to work
  // controls=0 - hide controls
  // showinfo=0 - hide video title (deprecated but included)
  // modestbranding=1 - minimal YouTube branding
  // rel=0 - don't show related videos at end
  // disablekb=1 - disable keyboard controls
  // fs=0 - disable fullscreen button
  // iv_load_policy=3 - hide annotations
  // playsinline=1 - play inline on mobile
  const embedUrl = `https://www.youtube.com/embed/${videoId}?` +
    `autoplay=1&mute=1&loop=1&playlist=${videoId}&` +
    `controls=0&showinfo=0&modestbranding=1&rel=0&` +
    `disablekb=1&fs=0&iv_load_policy=3&playsinline=1`

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      <iframe
        src={embedUrl}
        title="Background Video"
        className="absolute"
        style={{
          // Cover the entire screen while maintaining 16:9 aspect ratio
          top: '50%',
          left: '50%',
          width: '177.78vh', // 16:9 aspect ratio (100vh * 16/9)
          height: '100vh',
          minWidth: '100%',
          minHeight: '56.25vw', // 16:9 aspect ratio (100vw * 9/16)
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none', // Prevent interaction
          border: 'none'
        }}
        allow="autoplay; encrypted-media"
      />
    </div>
  )
}
