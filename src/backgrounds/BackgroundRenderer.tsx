import StarfieldBackground from './StarfieldBackground'
import MatrixRainBackground from './MatrixRainBackground'
import GradientBackground from './GradientBackground'
import VideoBackground from './VideoBackground'
import YouTubeBackground from './YouTubeBackground'
import CircularVisualizerBackground from './CircularVisualizerBackground'

export type BackgroundType = 'none' | 'starfield' | 'matrix' | 'gradient' | 'video' | 'youtube' | 'visualizer'

interface Props {
  type: BackgroundType
  videoPath?: string | null  // For local video
  youtubeUrl?: string | null // For YouTube embed
  analyserNode?: AnalyserNode | null // For audio visualizer (microphone input)
}

export default function BackgroundRenderer({ type, videoPath, youtubeUrl, analyserNode }: Props) {
  switch (type) {
    case 'starfield':
      return <StarfieldBackground />
    case 'matrix':
      return <MatrixRainBackground />
    case 'gradient':
      return <GradientBackground />
    case 'video':
      return videoPath ? <VideoBackground path={videoPath} /> : null
    case 'youtube':
      return youtubeUrl ? <YouTubeBackground url={youtubeUrl} /> : null
    case 'visualizer':
      return <CircularVisualizerBackground analyserNode={analyserNode} />
    case 'none':
    default:
      return null
  }
}
