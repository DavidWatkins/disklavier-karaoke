import Soundfont, { Player, InstrumentName } from 'soundfont-player'
// @ts-expect-error - sfumato doesn't have type definitions
import { loadSoundfont, startPresetNote } from 'sfumato'

// General MIDI instrument names for soundfont-player
const GM_INSTRUMENTS: string[] = [
  'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honky_tonk_piano',
  'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
  'celesta', 'glockenspiel', 'music_box', 'vibraphone',
  'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
  'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
  'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
  'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean',
  'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
  'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass',
  'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
  'violin', 'viola', 'cello', 'contrabass',
  'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
  'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2',
  'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit',
  'trumpet', 'trombone', 'tuba', 'muted_trumpet',
  'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
  'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
  'oboe', 'english_horn', 'bassoon', 'clarinet',
  'piccolo', 'flute', 'recorder', 'pan_flute',
  'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
  'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff',
  'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass_lead',
  'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir',
  'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep',
  'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere',
  'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi',
  'sitar', 'banjo', 'shamisen', 'koto',
  'kalimba', 'bagpipe', 'fiddle', 'shanai',
  'tinkle_bell', 'agogo', 'steel_drums', 'woodblock',
  'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
  'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet',
  'telephone_ring', 'helicopter', 'applause', 'gunshot'
]

// CDN soundfont names
type CdnSoundfontName = 'FluidR3_GM' | 'MusyngKite'

interface ActiveNote {
  stopFn: () => void
}

interface SF2Preset {
  header: {
    bank: number
    preset: number
    name: string
  }
  zones: unknown[]
}

interface SF2Soundfont {
  presets: SF2Preset[]
}

class AudioSynthesizer {
  private audioContext: AudioContext | null = null
  private isInitialized = false
  private isMuted = false
  private gainNode: GainNode | null = null
  private analyserNode: AnalyserNode | null = null
  private activeNotes: Map<string, ActiveNote> = new Map()

  // CDN mode (soundfont-player)
  private instruments: Map<number, Player> = new Map()
  private loadingInstruments: Set<number> = new Set()
  private defaultInstrument: Player | null = null
  private cdnSoundfontName: CdnSoundfontName = 'FluidR3_GM'

  // Local SF2 mode (sfumato)
  private sf2Soundfont: SF2Soundfont | null = null
  private presetMap: Map<number, SF2Preset> = new Map() // program number -> preset

  // Current mode
  private currentSoundfontId: string = 'cdn:FluidR3_GM'
  private isLoadingSoundfont = false

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    // Create audio context
    this.audioContext = new AudioContext()

    // Create master gain node
    this.gainNode = this.audioContext.createGain()
    this.gainNode.gain.value = 0.8
    this.gainNode.connect(this.audioContext.destination)

    // Create analyser node for visualizations (connected to destination to capture all audio)
    this.analyserNode = this.audioContext.createAnalyser()
    this.analyserNode.fftSize = 256
    this.analyserNode.smoothingTimeConstant = 0.8
    // Connect destination to analyser via a MediaStreamDestination workaround
    // For now, just create the analyser - visualizer will use demo mode

    // Load saved soundfont preference
    const savedSoundfont = localStorage.getItem('soundfontId')
    if (savedSoundfont) {
      this.currentSoundfontId = savedSoundfont
    }

    this.isInitialized = true
    console.log('Audio synthesizer initialized')

    // Load the selected soundfont
    await this.loadSoundfont(this.currentSoundfontId)
  }

  async loadSoundfont(soundfontId: string): Promise<void> {
    if (!this.audioContext || this.isLoadingSoundfont) return

    this.isLoadingSoundfont = true
    console.log('Loading soundfont:', soundfontId)

    // Stop all notes and clear old data
    this.allNotesOff()

    try {
      if (soundfontId.startsWith('cdn:')) {
        // CDN mode - use soundfont-player
        const cdnName = soundfontId.replace('cdn:', '') as CdnSoundfontName
        await this.loadCdnSoundfont(cdnName)
        this.sf2Soundfont = null
        this.presetMap.clear()
      } else if (soundfontId.startsWith('local:')) {
        // Local SF2 mode - use sfumato
        const filename = soundfontId.replace('local:', '')
        await this.loadLocalSoundfont(filename)
        // Clear CDN instruments
        this.instruments.clear()
        this.defaultInstrument = null
      }

      this.currentSoundfontId = soundfontId
      localStorage.setItem('soundfontId', soundfontId)
      console.log('Soundfont loaded successfully:', soundfontId)
    } catch (error) {
      console.error('Failed to load soundfont:', error)
      // Fall back to CDN if local fails
      if (!soundfontId.startsWith('cdn:')) {
        console.log('Falling back to CDN soundfont')
        await this.loadCdnSoundfont('FluidR3_GM')
        this.currentSoundfontId = 'cdn:FluidR3_GM'
        localStorage.setItem('soundfontId', this.currentSoundfontId)
      }
    } finally {
      this.isLoadingSoundfont = false
    }
  }

  private async loadCdnSoundfont(soundfontName: CdnSoundfontName): Promise<void> {
    if (!this.audioContext) return

    // Clear existing instruments when switching CDN soundfonts
    this.instruments.clear()
    this.cdnSoundfontName = soundfontName

    console.log(`Loading default piano soundfont (${soundfontName})...`)
    this.defaultInstrument = await Soundfont.instrument(
      this.audioContext,
      'acoustic_grand_piano',
      { gain: 2.0, soundfont: soundfontName }
    )
    console.log('Default piano soundfont loaded!')
  }

  private async loadLocalSoundfont(filename: string): Promise<void> {
    if (!this.audioContext) return

    // In Electron, we get the base URL from the location
    // The web server runs on port 3333
    const baseUrl = 'http://localhost:3333'
    const url = `${baseUrl}/soundfont/${encodeURIComponent(filename)}`

    console.log(`Loading SF2 from: ${url}`)
    this.sf2Soundfont = await loadSoundfont(url)

    // Build preset map (program number -> preset)
    this.presetMap.clear()
    if (this.sf2Soundfont?.presets) {
      for (const preset of this.sf2Soundfont.presets) {
        // Bank 0 is General MIDI
        if (preset.header.bank === 0) {
          this.presetMap.set(preset.header.preset, preset)
        }
      }
      console.log(`Loaded ${this.presetMap.size} GM presets from SF2`)
    }
  }

  private async loadCdnInstrument(program: number): Promise<Player | null> {
    if (!this.audioContext) return null
    if (this.instruments.has(program)) return this.instruments.get(program)!
    if (this.loadingInstruments.has(program)) return null

    this.loadingInstruments.add(program)

    const instrumentName = GM_INSTRUMENTS[program] || 'acoustic_grand_piano'

    try {
      const player = await Soundfont.instrument(
        this.audioContext,
        instrumentName as InstrumentName,
        { gain: 2.0, soundfont: this.cdnSoundfontName }
      )
      this.instruments.set(program, player)
      console.log(`Loaded instrument: ${instrumentName} (${this.cdnSoundfontName})`)
      return player
    } catch (error) {
      console.error(`Failed to load ${instrumentName}:`, error)
      return null
    } finally {
      this.loadingInstruments.delete(program)
    }
  }

  noteOn(channel: number, midiNote: number, velocity: number, program?: number): void {
    if (!this.isInitialized || this.isMuted || !this.audioContext) return

    // Channel 9 (10 in 1-indexed) is drums - skip for now
    if ((channel & 0x0F) === 9) return

    const noteKey = `${channel}-${midiNote}`
    const instrumentProgram = program ?? 0

    // Convert MIDI velocity (0-127) to gain (0-1)
    const gain = (velocity / 127) * 2.0

    try {
      if (this.sf2Soundfont) {
        // Local SF2 mode using sfumato
        const preset = this.presetMap.get(instrumentProgram) || this.presetMap.get(0)
        if (!preset) {
          console.warn('No preset found for program', instrumentProgram)
          return
        }

        const stopFn = startPresetNote(
          this.audioContext,
          preset,
          midiNote,
          this.audioContext.currentTime
        )

        this.activeNotes.set(noteKey, { stopFn })
      } else {
        // CDN mode using soundfont-player
        let player = this.instruments.get(instrumentProgram)
        if (!player) {
          // Start loading the instrument in background
          this.loadCdnInstrument(instrumentProgram)
          // Use default piano while loading
          player = this.defaultInstrument ?? undefined
        }
        if (!player) return

        const playingNote = player.play(midiNote.toString(), this.audioContext.currentTime, {
          gain,
          duration: 10 // Long duration, we'll stop manually
        })

        this.activeNotes.set(noteKey, {
          stopFn: () => playingNote.stop()
        })
      }
    } catch (error) {
      // Silently ignore note errors
    }
  }

  noteOff(channel: number, midiNote: number): void {
    if (!this.isInitialized) return

    const noteKey = `${channel}-${midiNote}`
    const activeNote = this.activeNotes.get(noteKey)

    if (activeNote) {
      try {
        activeNote.stopFn()
      } catch {
        // Ignore stop errors
      }
      this.activeNotes.delete(noteKey)
    }
  }

  allNotesOff(): void {
    if (!this.isInitialized) return

    for (const [, activeNote] of this.activeNotes) {
      try {
        activeNote.stopFn()
      } catch {
        // Ignore errors
      }
    }
    this.activeNotes.clear()
  }

  setVolume(value: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, value))
    }
  }

  mute(): void {
    this.isMuted = true
    this.allNotesOff()
  }

  unmute(): void {
    this.isMuted = false
  }

  toggleMute(): boolean {
    if (this.isMuted) {
      this.unmute()
    } else {
      this.mute()
    }
    return this.isMuted
  }

  getIsMuted(): boolean {
    return this.isMuted
  }

  getCurrentSoundfontId(): string {
    return this.currentSoundfontId
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode
  }

  dispose(): void {
    this.allNotesOff()
    this.instruments.clear()
    this.defaultInstrument = null
    this.sf2Soundfont = null
    this.presetMap.clear()
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.isInitialized = false
  }
}

// Export singleton instance
export const audioSynthesizer = new AudioSynthesizer()
