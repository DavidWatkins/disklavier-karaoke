/**
 * WebSocket MIDI Output - connects to Disklavier Pi's WebSocket interface
 * This bypasses Network MIDI (RTP-MIDI) which has compatibility issues with
 * rtpmidid's journal parsing. Instead, we send MIDI commands over WebSocket
 * and let the Pi forward them to the Disklavier via USB MIDI.
 */

import WebSocket from 'ws'

export interface WebSocketMidiConfig {
  host: string  // e.g., 'elwynn.local' or '192.168.0.251'
  port: number  // default 8080
}

export class WebSocketMidiOutput {
  private ws: WebSocket | null = null
  private config: WebSocketMidiConfig | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 3
  private sendCount = 0
  private isConnecting = false

  async connect(config: WebSocketMidiConfig): Promise<boolean> {
    if (this.isConnecting) return false
    this.isConnecting = true
    this.config = config

    return new Promise((resolve) => {
      try {
        this.disconnect()

        const url = `ws://${config.host}:${config.port}/ws/piano`
        console.log(`[WebSocketMidi] Connecting to ${url}`)

        this.ws = new WebSocket(url)

        const timeout = setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            console.error('[WebSocketMidi] Connection timeout')
            this.ws?.close()
            this.isConnecting = false
            resolve(false)
          }
        }, 5000)

        this.ws.on('open', () => {
          clearTimeout(timeout)
          console.log(`[WebSocketMidi] Connected to Disklavier Pi at ${url}`)
          this.reconnectAttempts = 0
          this.isConnecting = false
          resolve(true)
        })

        this.ws.on('error', (error) => {
          clearTimeout(timeout)
          console.error('[WebSocketMidi] Error:', error.message)
          this.isConnecting = false
          resolve(false)
        })

        this.ws.on('close', () => {
          console.log('[WebSocketMidi] Connection closed')
          this.ws = null
        })

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString())
            if (msg.type === 'error') {
              console.error('[WebSocketMidi] Server error:', msg.message)
            } else if (msg.type === 'connected') {
              console.log('[WebSocketMidi] MIDI device:', msg.midi_device)
            }
          } catch {
            // Ignore non-JSON messages
          }
        })

      } catch (error) {
        console.error('[WebSocketMidi] Failed to connect:', error)
        this.isConnecting = false
        resolve(false)
      }
    })
  }

  disconnect(): void {
    if (this.ws) {
      try {
        // Send panic before disconnecting
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'panic' }))
        }
        this.ws.close()
      } catch (error) {
        console.error('[WebSocketMidi] Error closing:', error)
      }
      this.ws = null
    }
  }

  /**
   * Send a MIDI message (compatible with JZZ output interface)
   * @param message - Array of MIDI bytes [status, data1, data2]
   */
  send(message: number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      this.sendCount++
      const status = message[0]
      const statusType = status & 0xF0

      let wsMessage: object

      switch (statusType) {
        case 0x90: // Note On
          if (message[2] === 0) {
            wsMessage = { type: 'note_off', note: message[1] }
          } else {
            wsMessage = { type: 'note_on', note: message[1], velocity: message[2] }
          }
          break

        case 0x80: // Note Off
          wsMessage = { type: 'note_off', note: message[1] }
          break

        case 0xB0: // Control Change
          if (message[1] === 64) {
            wsMessage = { type: 'sustain', on: message[2] >= 64 }
          } else if (message[1] === 123) {
            wsMessage = { type: 'panic' }
          } else {
            wsMessage = { type: 'control_change', control: message[1], value: message[2] }
          }
          break

        default:
          // For other message types, skip (piano doesn't need them)
          return
      }

      if (this.sendCount <= 5 || this.sendCount % 100 === 0) {
        console.log(`[WebSocketMidi SEND #${this.sendCount}] ${JSON.stringify(wsMessage)}`)
      }

      this.ws.send(JSON.stringify(wsMessage))
    } catch (error) {
      console.error('[WebSocketMidi] Send error:', error)
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  getConnectedHost(): string | null {
    return this.config?.host ?? null
  }

  /**
   * Close the connection (alias for disconnect, for JZZ compatibility)
   */
  close(): void {
    this.disconnect()
  }
}

// Singleton instance
export const webSocketMidiOutput = new WebSocketMidiOutput()
