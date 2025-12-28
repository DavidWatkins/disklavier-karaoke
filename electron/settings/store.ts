import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'

export type BackgroundType = 'none' | 'starfield' | 'matrix' | 'gradient' | 'visualizer' | 'video' | 'youtube'
export type LyricsMode = 'normal' | 'bouncing'

export interface Settings {
  soundfontId: string
  lyricsMode: LyricsMode
  backgroundType: BackgroundType
  backgroundVideoPath: string | null
  youtubeBackgroundEnabled: boolean
  showWifiQR: boolean
  midiOutputName: string
  midiDelayMs: number
  catalogPath: string
}

const DEFAULT_SETTINGS: Settings = {
  soundfontId: 'cdn:FluidR3_GM',
  lyricsMode: 'normal',
  backgroundType: 'none',
  backgroundVideoPath: null,
  youtubeBackgroundEnabled: true,
  showWifiQR: false,
  midiOutputName: '',
  midiDelayMs: 0,
  catalogPath: ''
}

class SettingsStore extends EventEmitter {
  private settings: Settings = { ...DEFAULT_SETTINGS }
  private filePath: string = ''
  private initialized = false

  initialize(): void {
    if (this.initialized) return

    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'settings.json')

    console.log(`Settings file: ${this.filePath}`)

    this.load()
    this.initialized = true
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8')
        const loaded = JSON.parse(data) as Partial<Settings>

        // Merge with defaults to ensure all keys exist
        this.settings = { ...DEFAULT_SETTINGS, ...loaded }
        console.log('Settings loaded from disk')
      } else {
        // Create file with defaults
        this.save()
        console.log('Settings file created with defaults')
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  private save(): void {
    try {
      const data = JSON.stringify(this.settings, null, 2)
      fs.writeFileSync(this.filePath, data, 'utf-8')
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  getAll(): Settings {
    return { ...this.settings }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key]
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const oldValue = this.settings[key]
    if (oldValue === value) return

    this.settings[key] = value
    this.save()

    // Emit change event for listeners
    this.emit('change', { key, value, oldValue })
  }

  update(updates: Partial<Settings>): void {
    let changed = false

    for (const [key, value] of Object.entries(updates)) {
      if (key in DEFAULT_SETTINGS && this.settings[key as keyof Settings] !== value) {
        (this.settings as Record<string, unknown>)[key] = value
        changed = true
        this.emit('change', { key, value, oldValue: this.settings[key as keyof Settings] })
      }
    }

    if (changed) {
      this.save()
    }
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this.save()
    this.emit('reset', this.settings)
  }
}

// Export singleton instance
export const settingsStore = new SettingsStore()
