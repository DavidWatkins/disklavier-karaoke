import { useRef, useEffect } from 'react'

interface Props {
  path: string
}

export default function VideoBackground({ path }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.play().catch(err => {
        console.log('Video autoplay blocked:', err.message)
      })
    }
  }, [path])

  // Convert file path to proper URL for Electron
  const videoSrc = path.startsWith('file://') ? path : `file://${path}`

  return (
    <video
      ref={videoRef}
      src={videoSrc}
      autoPlay
      loop
      muted
      playsInline
      className="absolute inset-0 w-full h-full object-cover"
      style={{ zIndex: 0 }}
    />
  )
}
