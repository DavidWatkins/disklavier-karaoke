import JZZ from 'jzz'
import { WebSocketMidiOutput } from './websocket-output.js'

// WebSocket output for MIDI Piano Pi Server (bypasses Network MIDI issues)
const wsOutput = new WebSocketMidiOutput()

// Helper to convert raw MIDI arrays to JZZ MIDI messages
// This fixes Network MIDI byte corruption issues
function toJZZMessage(message: number[]): ReturnType<typeof JZZ.MIDI> {
  if (message.length < 1) return JZZ.MIDI()

  const status = message[0]
  const statusType = status & 0xF0
  const channel = status & 0x0F

  switch (statusType) {
    case 0x90: // Note On
      if (message.length >= 3) {
        return JZZ.MIDI.noteOn(channel, message[1], message[2])
      }
      break
    case 0x80: // Note Off
      if (message.length >= 3) {
        return JZZ.MIDI.noteOff(channel, message[1], message[2])
      }
      break
    case 0xB0: // Control Change
      if (message.length >= 3) {
        return JZZ.MIDI.control(channel, message[1], message[2])
      }
      break
    case 0xC0: // Program Change
      if (message.length >= 2) {
        return JZZ.MIDI.program(channel, message[1])
      }
      break
    case 0xE0: // Pitch Bend
      if (message.length >= 3) {
        return JZZ.MIDI.pitchBend(channel, message[1], message[2])
      }
      break
  }

  // Fallback: wrap raw bytes in JZZ.MIDI
  return JZZ.MIDI.apply(null, message)
}

export interface MidiOutputDevice {
  name: string
  id: string
}

export interface MidiOutputManager {
  getOutputs(): Promise<MidiOutputDevice[]>
  connect(name: string): Promise<boolean>
  disconnect(): void
  send(message: number[]): void
  isConnected(): boolean
  getConnectedName(): string | null
}

class MidiOutputManagerImpl implements MidiOutputManager {
  private output: ReturnType<typeof JZZ.MIDI.out> | null = null
  private connectedName: string | null = null
  private jzz: ReturnType<typeof JZZ> | null = null
  private isSwitching = false  // Lock to prevent sends during output switch

  async initialize(): Promise<void> {
    if (this.jzz) return

    try {
      this.jzz = await JZZ()
      console.log('JZZ MIDI initialized')
    } catch (error) {
      console.error('Failed to initialize JZZ MIDI:', error)
      throw error
    }
  }

  async getOutputs(): Promise<MidiOutputDevice[]> {
    await this.initialize()

    if (!this.jzz) return []

    const info = this.jzz.info()
    const outputs: MidiOutputDevice[] = []

    for (const output of info.outputs) {
      outputs.push({
        name: output.name,
        id: output.id || output.name
      })
    }

    return outputs
  }

  async connect(name: string): Promise<boolean> {
    await this.initialize()

    if (!this.jzz) {
      console.error('JZZ not initialized!')
      return false
    }

    try {
      // Set switching lock to prevent sends during transition
      this.isSwitching = true

      // Disconnect any existing output
      this.disconnect()

      // Small delay to let any in-flight sends complete
      await new Promise(resolve => setTimeout(resolve, 50))

      console.log(`Attempting to open MIDI output: ${name}`)

      // Try to open the output by name
      this.output = this.jzz.openMidiOut(name)
      this.connectedName = name

      // Clear switching lock
      this.isSwitching = false

      console.log(`Connected to MIDI output: ${name}`)
      console.log(`Output object:`, this.output ? 'exists' : 'null')
      return true
    } catch (error) {
      this.isSwitching = false
      console.error(`Failed to connect to MIDI output ${name}:`, error)
      return false
    }
  }

  disconnect(): void {
    if (this.output) {
      try {
        // Send all notes off before disconnecting
        for (let channel = 0; channel < 16; channel++) {
          // Use JZZ message constructors to fix Network MIDI byte corruption
          this.output.send(JZZ.MIDI.control(channel, 123, 0)) // All Notes Off
          this.output.send(JZZ.MIDI.control(channel, 121, 0)) // Reset All Controllers
        }
        this.output.close()
      } catch (error) {
        console.error('Error closing MIDI output:', error)
      }
      this.output = null
      this.connectedName = null
    }
  }

  private sendCount = 0

  send(message: number[]): void {
    // Skip sends during output switching to prevent crashes
    if (this.isSwitching) {
      return
    }

    if (this.output) {
      try {
        this.sendCount++
        // Log first few sends with full details
        if (this.sendCount <= 10) {
          const jzzMessage = toJZZMessage(message)
          console.log(`[MidiOutput SEND #${this.sendCount}] to ${this.connectedName}:`)
          console.log(`  Input array: [${message.join(', ')}]`)
          console.log(`  JZZ message: ${JSON.stringify(jzzMessage)}`)
          console.log(`  JZZ toString: ${jzzMessage.toString()}`)
          console.log(`  JZZ bytes: [${Array.from(jzzMessage).join(', ')}]`)
          this.output.send(jzzMessage)
        } else {
          // Use JZZ MIDI message constructors to fix Network MIDI byte corruption
          const jzzMessage = toJZZMessage(message)
          this.output.send(jzzMessage)
        }
      } catch (error) {
        console.error('Error sending MIDI message:', error)
      }
    }
    // Silently ignore sends when no output connected - this is expected when no MIDI piano is available
  }

  isConnected(): boolean {
    return this.output !== null
  }

  getConnectedName(): string | null {
    return this.connectedName
  }
}

// Singleton instance
export const midiOutputManager = new MidiOutputManagerImpl()

/**
 * List all available MIDI outputs
 */
export async function listMidiOutputs(): Promise<MidiOutputDevice[]> {
  return midiOutputManager.getOutputs()
}

/**
 * Connect to a MIDI output by name
 */
export async function connectMidiOutput(name: string): Promise<boolean> {
  return midiOutputManager.connect(name)
}

/**
 * Disconnect from the current MIDI output
 */
export function disconnectMidiOutput(): void {
  midiOutputManager.disconnect()
}

/**
 * Send a MIDI message
 */
export function sendMidiMessage(message: number[]): void {
  midiOutputManager.send(message)
}

/**
 * Get the current MIDI connection status
 */
export function getMidiStatus(): { connected: boolean; outputName: string | null } {
  return {
    connected: midiOutputManager.isConnected(),
    outputName: midiOutputManager.getConnectedName()
  }
}

/**
 * Auto-detect and connect to a Yamaha MIDI piano
 * Looks for common Yamaha USB/network MIDI names
 */
export async function autoConnectDisklavier(): Promise<boolean> {
  const outputs = await listMidiOutputs()

  // Log available outputs for debugging
  if (outputs.length > 0) {
    console.log('Available MIDI outputs:', outputs.map(o => o.name).join(', '))
  }

  // Common Yamaha MIDI names - ordered by priority
  const disklavierPatterns = [
    /disklavier/i,           // Disklavier match
    /dkv/i,                  // DKV abbreviation
    /yamaha.*piano/i,        // Yamaha Piano
    /clavinova/i,            // Clavinova series
    /yamaha.*usb/i,          // Yamaha USB MIDI
    /yamaha.*network/i,      // Network MIDI
    /network.*session/i,     // Network session MIDI
    /yamaha/i                // Any Yamaha device (last resort)
  ]

  for (const pattern of disklavierPatterns) {
    for (const output of outputs) {
      if (pattern.test(output.name)) {
        console.log(`Auto-detected Yamaha MIDI: ${output.name}`)
        return connectMidiOutput(output.name)
      }
    }
  }

  if (outputs.length === 0) {
    console.log('No MIDI outputs available')
  } else {
    console.log('No Yamaha MIDI auto-detected among available outputs')
  }
  return false
}

// ============================================
// WebSocket MIDI Output (MIDI Piano Pi Server Direct)
// ============================================
// Use this when Network MIDI has issues (rtpmidid journal parsing bugs)

/**
 * Connect to MIDI Piano Pi Server via WebSocket
 * This bypasses Network MIDI and sends commands directly to the Pi's web interface
 * @param host - Hostname or IP of the Pi (e.g., 'raspberrypi.local' or '192.168.0.251')
 * @param port - Web server port (default 8080)
 */
export async function connectWebSocketMidi(host: string, port: number = 8080): Promise<boolean> {
  // Disconnect any existing JZZ connection
  midiOutputManager.disconnect()

  return wsOutput.connect({ host, port })
}

/**
 * Disconnect from WebSocket MIDI
 */
export function disconnectWebSocketMidi(): void {
  wsOutput.disconnect()
}

/**
 * Send MIDI via WebSocket (if connected)
 */
export function sendWebSocketMidi(message: number[]): void {
  wsOutput.send(message)
}

/**
 * Check if WebSocket MIDI is connected
 */
export function isWebSocketMidiConnected(): boolean {
  return wsOutput.isConnected()
}

/**
 * Get WebSocket connection info
 */
export function getWebSocketMidiStatus(): { connected: boolean; host: string | null } {
  return {
    connected: wsOutput.isConnected(),
    host: wsOutput.getConnectedHost()
  }
}

/**
 * Universal send - sends via WebSocket if connected, otherwise via JZZ
 */
export function sendMidiUniversal(message: number[]): void {
  if (wsOutput.isConnected()) {
    wsOutput.send(message)
  } else {
    midiOutputManager.send(message)
  }
}

/**
 * Get combined MIDI status
 */
export function getUniversalMidiStatus(): {
  connected: boolean
  type: 'websocket' | 'midi' | 'none'
  name: string | null
} {
  if (wsOutput.isConnected()) {
    return {
      connected: true,
      type: 'websocket',
      name: `MIDI Piano Pi Server (${wsOutput.getConnectedHost()})`
    }
  }
  if (midiOutputManager.isConnected()) {
    return {
      connected: true,
      type: 'midi',
      name: midiOutputManager.getConnectedName()
    }
  }
  return {
    connected: false,
    type: 'none',
    name: null
  }
}
