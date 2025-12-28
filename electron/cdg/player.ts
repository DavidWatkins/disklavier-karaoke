/**
 * CDG Player
 *
 * Manages CDG playback timing and emits frame updates synchronized with audio.
 * Unlike MIDI, CDG doesn't control audio - it just provides graphics that need
 * to be synchronized with a separate audio player.
 */

import { EventEmitter } from 'events'
import {
  parseCdgFile,
  CdgRenderer,
  type ParsedCdg,
  type CdgPacket,
  CDG_VISIBLE_WIDTH,
  CDG_VISIBLE_HEIGHT
} from './parser.js'

export interface CdgPlayerState {
  playing: boolean
  paused: boolean
  currentTime: number
  duration: number
  title: string
  singerName: string
  songId: number
  fileType: 'cdg'
  audioPath: string | null
}

export interface CdgFrameData {
  width: number
  height: number
  rgba: Uint8ClampedArray
  timestamp: number
}

export class CdgPlayer extends EventEmitter {
  private cdgData: ParsedCdg | null = null
  private renderer: CdgRenderer = new CdgRenderer()
  private state: CdgPlayerState = {
    playing: false,
    paused: false,
    currentTime: 0,
    duration: 0,
    title: '',
    singerName: '',
    songId: 0,
    fileType: 'cdg',
    audioPath: null
  }
  private animationFrame: NodeJS.Timeout | null = null
  private lastUpdateTime: number = 0
  private packetIndex: number = 0
  private startTime: number = 0
  private pauseTime: number = 0

  constructor() {
    super()
  }

  /**
   * Load a CDG file for playback
   */
  loadSong(
    cdgPath: string,
    audioPath: string,
    title: string,
    singerName: string,
    songId: number
  ): void {
    this.stop()

    try {
      this.cdgData = parseCdgFile(cdgPath)
      this.renderer.reset()
      this.packetIndex = 0

      this.state = {
        playing: false,
        paused: false,
        currentTime: 0,
        duration: this.cdgData.durationMs,
        title,
        singerName,
        songId,
        fileType: 'cdg',
        audioPath
      }

      // Apply initial packets up to time 0 (setup commands)
      this.applyPacketsUpTo(0)

      // Emit initial frame
      this.emitFrame()

      console.log(`CDG loaded: ${title} (${this.cdgData.packets.length} packets, ${this.state.duration}ms)`)
    } catch (error) {
      console.error('Failed to load CDG file:', error)
      throw error
    }
  }

  /**
   * Start or resume playback
   * Note: Audio playback should be started separately in the renderer
   */
  play(): void {
    if (!this.cdgData) return
    if (this.state.playing && !this.state.paused) return

    if (this.state.paused) {
      // Resume from pause
      this.startTime += Date.now() - this.pauseTime
    } else {
      // Start fresh
      this.startTime = Date.now()
    }

    this.state.playing = true
    this.state.paused = false
    this.lastUpdateTime = Date.now()

    this.startAnimationLoop()
    this.emit('play', this.getState())
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.state.playing || this.state.paused) return

    this.state.paused = true
    this.pauseTime = Date.now()
    this.stopAnimationLoop()
    this.emit('pause', this.getState())
  }

  /**
   * Stop playback and reset
   */
  stop(): void {
    this.stopAnimationLoop()

    if (this.cdgData) {
      this.renderer.reset()
      this.packetIndex = 0
    }

    this.state = {
      ...this.state,
      playing: false,
      paused: false,
      currentTime: 0
    }

    this.emit('stop', this.getState())
  }

  /**
   * Seek to a specific time
   */
  seek(timeMs: number): void {
    if (!this.cdgData) return

    // Clamp time
    timeMs = Math.max(0, Math.min(timeMs, this.state.duration))

    // Reset renderer and reapply all packets up to seek time
    this.renderer.reset()
    this.packetIndex = 0
    this.applyPacketsUpTo(timeMs)

    // Update timing
    this.state.currentTime = timeMs
    if (this.state.playing && !this.state.paused) {
      this.startTime = Date.now() - timeMs
    }

    this.emitFrame()
    this.emit('seek', { timeMs, state: this.getState() })
  }

  /**
   * Sync with external audio time
   * Call this periodically from the renderer with the actual audio time
   */
  syncToAudioTime(audioTimeMs: number): void {
    if (!this.cdgData || !this.state.playing || this.state.paused) return

    // Apply any packets between current time and audio time
    if (audioTimeMs > this.state.currentTime) {
      this.applyPacketsFromTo(this.state.currentTime, audioTimeMs)
    } else if (audioTimeMs < this.state.currentTime - 1000) {
      // Audio jumped back significantly, resync
      this.seek(audioTimeMs)
      return
    }

    this.state.currentTime = audioTimeMs

    // Check for end
    if (audioTimeMs >= this.state.duration) {
      this.stop()
      this.emit('ended')
      return
    }
  }

  /**
   * Get current player state
   */
  getState(): CdgPlayerState {
    return { ...this.state }
  }

  /**
   * Get current frame data
   */
  getCurrentFrame(): CdgFrameData | null {
    if (!this.cdgData) return null

    return {
      width: CDG_VISIBLE_WIDTH,
      height: CDG_VISIBLE_HEIGHT,
      rgba: this.renderer.getVisibleRgbaFrame(),
      timestamp: this.state.currentTime
    }
  }

  /**
   * Apply all packets up to a given time
   */
  private applyPacketsUpTo(timeMs: number): void {
    if (!this.cdgData) return

    while (
      this.packetIndex < this.cdgData.packets.length &&
      this.cdgData.packets[this.packetIndex].timeMs <= timeMs
    ) {
      const packet = this.cdgData.packets[this.packetIndex]
      if (packet.instruction) {
        this.renderer.applyInstruction(packet.instruction)
      }
      this.packetIndex++
    }

    this.state.currentTime = timeMs
  }

  /**
   * Apply packets between two times
   */
  private applyPacketsFromTo(fromMs: number, toMs: number): void {
    if (!this.cdgData) return

    while (
      this.packetIndex < this.cdgData.packets.length &&
      this.cdgData.packets[this.packetIndex].timeMs <= toMs
    ) {
      const packet = this.cdgData.packets[this.packetIndex]
      if (packet.instruction) {
        this.renderer.applyInstruction(packet.instruction)
      }
      this.packetIndex++
    }
  }

  /**
   * Emit current frame to renderer
   */
  private emitFrame(): void {
    const frame = this.getCurrentFrame()
    if (frame) {
      this.emit('frame', frame)
    }
  }

  /**
   * Start the animation loop
   */
  private startAnimationLoop(): void {
    this.stopAnimationLoop()

    // Update at ~30fps for CDG (enough for smooth display)
    const update = () => {
      if (!this.state.playing || this.state.paused) return

      const now = Date.now()
      const currentTime = now - this.startTime

      // Apply packets up to current time
      this.applyPacketsFromTo(this.state.currentTime, currentTime)
      this.state.currentTime = currentTime

      // Emit frame update
      this.emitFrame()

      // Emit progress update at lower rate
      if (now - this.lastUpdateTime > 100) {
        this.emit('update', this.getState())
        this.lastUpdateTime = now
      }

      // Check for end
      if (currentTime >= this.state.duration) {
        this.stop()
        this.emit('ended')
        return
      }

      this.animationFrame = setTimeout(update, 33) // ~30fps
    }

    update()
  }

  /**
   * Stop the animation loop
   */
  private stopAnimationLoop(): void {
    if (this.animationFrame) {
      clearTimeout(this.animationFrame)
      this.animationFrame = null
    }
  }
}

// Singleton instance
export const cdgPlayer = new CdgPlayer()
