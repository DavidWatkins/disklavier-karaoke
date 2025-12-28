/**
 * CDG (CD+Graphics) Parser
 *
 * CDG is a graphics format used for karaoke that encodes drawing commands
 * synchronized with audio. The format delivers 300 packets per second,
 * with each packet containing one graphics instruction.
 *
 * Display: 300x216 pixels with a 6-pixel border on each side (visible area 288x192)
 * Colors: 16-color palette (4 bits per pixel)
 * Tiles: 6x12 pixel tiles for drawing operations
 */

import * as fs from 'fs'

// CDG Constants
export const CDG_WIDTH = 300
export const CDG_HEIGHT = 216
export const CDG_VISIBLE_WIDTH = 288
export const CDG_VISIBLE_HEIGHT = 192
export const CDG_BORDER_X = 6
export const CDG_BORDER_Y = 12
export const CDG_TILE_WIDTH = 6
export const CDG_TILE_HEIGHT = 12
export const CDG_PACKETS_PER_SECOND = 300
export const CDG_PACKET_SIZE = 24
export const CDG_COLORS = 16

// CDG Instruction types
export const CDG_INST = {
  MEMORY_PRESET: 1,
  BORDER_PRESET: 2,
  TILE_BLOCK: 6,
  SCROLL_PRESET: 20,
  SCROLL_COPY: 24,
  DEFINE_TRANSPARENT: 28,
  LOAD_COLOR_TABLE_LO: 30,
  LOAD_COLOR_TABLE_HI: 31,
  TILE_BLOCK_XOR: 38
}

// RGB color type
export interface CdgColor {
  r: number
  g: number
  b: number
}

// CDG Instruction types
export interface CdgMemoryPreset {
  type: 'memoryPreset'
  color: number
  repeat: number
}

export interface CdgBorderPreset {
  type: 'borderPreset'
  color: number
}

export interface CdgTileBlock {
  type: 'tileBlock'
  xor: boolean
  color0: number
  color1: number
  row: number
  column: number
  pixels: number[] // 12 rows of 6-bit pixel data
}

export interface CdgScroll {
  type: 'scroll'
  copy: boolean
  color: number
  hScroll: number // 0=none, 1=right 6px, 2=left 6px
  vScroll: number // 0=none, 1=down 12px, 2=up 12px
  hOffset: number // 0-5
  vOffset: number // 0-11
}

export interface CdgDefineTransparent {
  type: 'defineTransparent'
  color: number
}

export interface CdgLoadColorTable {
  type: 'loadColorTable'
  offset: number // 0 for low table, 8 for high table
  colors: CdgColor[]
}

export type CdgInstruction =
  | CdgMemoryPreset
  | CdgBorderPreset
  | CdgTileBlock
  | CdgScroll
  | CdgDefineTransparent
  | CdgLoadColorTable

export interface CdgPacket {
  timeMs: number
  instruction: CdgInstruction | null
}

export interface ParsedCdg {
  packets: CdgPacket[]
  durationMs: number
}

/**
 * Parse a CDG file and return timestamped instructions
 */
export function parseCdgFile(filePath: string): ParsedCdg {
  const buffer = fs.readFileSync(filePath)
  const packets: CdgPacket[] = []

  const numPackets = Math.floor(buffer.length / CDG_PACKET_SIZE)
  const durationMs = (numPackets / CDG_PACKETS_PER_SECOND) * 1000

  for (let i = 0; i < numPackets; i++) {
    const offset = i * CDG_PACKET_SIZE
    const packet = buffer.subarray(offset, offset + CDG_PACKET_SIZE)

    // CDG packet structure:
    // Byte 0: command (should be 0x09 for CDG)
    // Byte 1: instruction
    // Bytes 2-3: reserved
    // Bytes 4-19: data
    // Bytes 20-23: reserved

    const command = packet[0] & 0x3f
    const instruction = packet[1] & 0x3f

    // Only process CDG packets (command = 0x09)
    if (command !== 0x09) {
      continue
    }

    const timeMs = (i / CDG_PACKETS_PER_SECOND) * 1000
    const data = packet.subarray(4, 20)

    const parsed = parseInstruction(instruction, data)
    if (parsed) {
      packets.push({ timeMs, instruction: parsed })
    }
  }

  return { packets, durationMs }
}

/**
 * Parse a single CDG instruction
 */
function parseInstruction(instruction: number, data: Buffer): CdgInstruction | null {
  switch (instruction) {
    case CDG_INST.MEMORY_PRESET:
      return {
        type: 'memoryPreset',
        color: data[0] & 0x0f,
        repeat: data[1] & 0x0f
      }

    case CDG_INST.BORDER_PRESET:
      return {
        type: 'borderPreset',
        color: data[0] & 0x0f
      }

    case CDG_INST.TILE_BLOCK:
    case CDG_INST.TILE_BLOCK_XOR:
      return {
        type: 'tileBlock',
        xor: instruction === CDG_INST.TILE_BLOCK_XOR,
        color0: data[0] & 0x0f,
        color1: data[1] & 0x0f,
        row: data[2] & 0x1f,
        column: data[3] & 0x3f,
        pixels: Array.from(data.subarray(4, 16)).map(b => b & 0x3f)
      }

    case CDG_INST.SCROLL_PRESET:
    case CDG_INST.SCROLL_COPY:
      return {
        type: 'scroll',
        copy: instruction === CDG_INST.SCROLL_COPY,
        color: data[0] & 0x0f,
        hScroll: (data[1] & 0x30) >> 4,
        vScroll: (data[2] & 0x30) >> 4,
        hOffset: data[1] & 0x07,
        vOffset: data[2] & 0x0f
      }

    case CDG_INST.DEFINE_TRANSPARENT:
      return {
        type: 'defineTransparent',
        color: data[0] & 0x0f
      }

    case CDG_INST.LOAD_COLOR_TABLE_LO:
    case CDG_INST.LOAD_COLOR_TABLE_HI:
      // Each color entry is 2 bytes: RRRRGGGG BBBB0000
      const colors: CdgColor[] = []
      for (let i = 0; i < 8; i++) {
        const lo = data[i * 2] & 0x3f
        const hi = data[i * 2 + 1] & 0x3f
        colors.push({
          r: ((lo & 0x3c) >> 2) * 17, // Scale 0-15 to 0-255
          g: (((lo & 0x03) << 2) | ((hi & 0x30) >> 4)) * 17,
          b: (hi & 0x0f) * 17
        })
      }
      return {
        type: 'loadColorTable',
        offset: instruction === CDG_INST.LOAD_COLOR_TABLE_HI ? 8 : 0,
        colors
      }

    default:
      return null
  }
}

/**
 * CDG Renderer state machine
 * This maintains the pixel buffer and palette, applying instructions as they arrive
 */
export class CdgRenderer {
  private pixels: Uint8Array // 300x216 palette indices
  private palette: CdgColor[]
  private transparentColor: number
  private borderColor: number
  private hOffset: number
  private vOffset: number

  constructor() {
    this.pixels = new Uint8Array(CDG_WIDTH * CDG_HEIGHT)
    this.palette = new Array(CDG_COLORS).fill(null).map(() => ({ r: 0, g: 0, b: 0 }))
    this.transparentColor = -1
    this.borderColor = 0
    this.hOffset = 0
    this.vOffset = 0
  }

  /**
   * Reset the renderer to initial state
   */
  reset(): void {
    this.pixels.fill(0)
    this.palette = new Array(CDG_COLORS).fill(null).map(() => ({ r: 0, g: 0, b: 0 }))
    this.transparentColor = -1
    this.borderColor = 0
    this.hOffset = 0
    this.vOffset = 0
  }

  /**
   * Apply a CDG instruction
   */
  applyInstruction(inst: CdgInstruction): void {
    switch (inst.type) {
      case 'memoryPreset':
        // Clear screen with color (only on first repeat or repeat=0)
        if (inst.repeat === 0) {
          this.pixels.fill(inst.color)
        }
        break

      case 'borderPreset':
        this.borderColor = inst.color
        this.drawBorder(inst.color)
        break

      case 'tileBlock':
        this.drawTile(inst)
        break

      case 'scroll':
        this.hOffset = inst.hOffset
        this.vOffset = inst.vOffset
        if (inst.hScroll !== 0 || inst.vScroll !== 0) {
          this.scrollDisplay(inst)
        }
        break

      case 'defineTransparent':
        this.transparentColor = inst.color
        break

      case 'loadColorTable':
        for (let i = 0; i < 8; i++) {
          this.palette[inst.offset + i] = inst.colors[i]
        }
        break
    }
  }

  /**
   * Draw border with specified color
   */
  private drawBorder(color: number): void {
    // Top border (12 rows)
    for (let y = 0; y < CDG_BORDER_Y; y++) {
      for (let x = 0; x < CDG_WIDTH; x++) {
        this.pixels[y * CDG_WIDTH + x] = color
      }
    }

    // Bottom border (12 rows)
    for (let y = CDG_HEIGHT - CDG_BORDER_Y; y < CDG_HEIGHT; y++) {
      for (let x = 0; x < CDG_WIDTH; x++) {
        this.pixels[y * CDG_WIDTH + x] = color
      }
    }

    // Left border (6 columns)
    for (let y = CDG_BORDER_Y; y < CDG_HEIGHT - CDG_BORDER_Y; y++) {
      for (let x = 0; x < CDG_BORDER_X; x++) {
        this.pixels[y * CDG_WIDTH + x] = color
      }
    }

    // Right border (6 columns)
    for (let y = CDG_BORDER_Y; y < CDG_HEIGHT - CDG_BORDER_Y; y++) {
      for (let x = CDG_WIDTH - CDG_BORDER_X; x < CDG_WIDTH; x++) {
        this.pixels[y * CDG_WIDTH + x] = color
      }
    }
  }

  /**
   * Draw a 6x12 tile
   */
  private drawTile(tile: CdgTileBlock): void {
    const startX = tile.column * CDG_TILE_WIDTH
    const startY = tile.row * CDG_TILE_HEIGHT

    if (startX + CDG_TILE_WIDTH > CDG_WIDTH || startY + CDG_TILE_HEIGHT > CDG_HEIGHT) {
      return // Out of bounds
    }

    for (let row = 0; row < CDG_TILE_HEIGHT; row++) {
      const pixelData = tile.pixels[row]
      for (let col = 0; col < CDG_TILE_WIDTH; col++) {
        const bit = (pixelData >> (5 - col)) & 1
        const color = bit ? tile.color1 : tile.color0
        const x = startX + col
        const y = startY + row
        const idx = y * CDG_WIDTH + x

        if (tile.xor) {
          this.pixels[idx] ^= color
        } else {
          this.pixels[idx] = color
        }
      }
    }
  }

  /**
   * Scroll the display
   */
  private scrollDisplay(scroll: CdgScroll): void {
    const newPixels = new Uint8Array(CDG_WIDTH * CDG_HEIGHT)

    // Determine scroll direction
    const hDir = scroll.hScroll === 2 ? -CDG_TILE_WIDTH : scroll.hScroll === 1 ? CDG_TILE_WIDTH : 0
    const vDir = scroll.vScroll === 2 ? -CDG_TILE_HEIGHT : scroll.vScroll === 1 ? CDG_TILE_HEIGHT : 0

    for (let y = 0; y < CDG_HEIGHT; y++) {
      for (let x = 0; x < CDG_WIDTH; x++) {
        let srcX = x + hDir
        let srcY = y + vDir

        if (scroll.copy) {
          // Wrap around
          srcX = ((srcX % CDG_WIDTH) + CDG_WIDTH) % CDG_WIDTH
          srcY = ((srcY % CDG_HEIGHT) + CDG_HEIGHT) % CDG_HEIGHT
          newPixels[y * CDG_WIDTH + x] = this.pixels[srcY * CDG_WIDTH + srcX]
        } else {
          // Fill with border color
          if (srcX < 0 || srcX >= CDG_WIDTH || srcY < 0 || srcY >= CDG_HEIGHT) {
            newPixels[y * CDG_WIDTH + x] = scroll.color
          } else {
            newPixels[y * CDG_WIDTH + x] = this.pixels[srcY * CDG_WIDTH + srcX]
          }
        }
      }
    }

    this.pixels = newPixels
  }

  /**
   * Get the current frame as RGBA pixel data
   * Returns a Uint8ClampedArray suitable for ImageData
   */
  getRgbaFrame(): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(CDG_WIDTH * CDG_HEIGHT * 4)

    for (let i = 0; i < this.pixels.length; i++) {
      const colorIdx = this.pixels[i]
      const color = this.palette[colorIdx]
      const offset = i * 4

      rgba[offset] = color.r
      rgba[offset + 1] = color.g
      rgba[offset + 2] = color.b
      rgba[offset + 3] = colorIdx === this.transparentColor ? 0 : 255
    }

    return rgba
  }

  /**
   * Get the visible frame (without borders) as RGBA
   */
  getVisibleRgbaFrame(): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(CDG_VISIBLE_WIDTH * CDG_VISIBLE_HEIGHT * 4)

    for (let y = 0; y < CDG_VISIBLE_HEIGHT; y++) {
      for (let x = 0; x < CDG_VISIBLE_WIDTH; x++) {
        const srcX = x + CDG_BORDER_X + this.hOffset
        const srcY = y + CDG_BORDER_Y + this.vOffset
        const srcIdx = srcY * CDG_WIDTH + srcX
        const dstIdx = (y * CDG_VISIBLE_WIDTH + x) * 4

        const colorIdx = this.pixels[srcIdx]
        const color = this.palette[colorIdx]

        rgba[dstIdx] = color.r
        rgba[dstIdx + 1] = color.g
        rgba[dstIdx + 2] = color.b
        rgba[dstIdx + 3] = colorIdx === this.transparentColor ? 0 : 255
      }
    }

    return rgba
  }

  /**
   * Get current palette
   */
  getPalette(): CdgColor[] {
    return [...this.palette]
  }
}
