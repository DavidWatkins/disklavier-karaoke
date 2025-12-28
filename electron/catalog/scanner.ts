import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { catalogDb, type FileType } from './database.js'
import { getSongMetadata, parseKarFile } from '../midi/parser.js'

interface ScannedFile {
  path: string
  type: FileType
  audioPath?: string // For CDG files, the associated MP3 path
}

// Common Spanish words for language detection
const SPANISH_WORDS = new Set([
  'que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'por', 'para',
  'se', 'yo', 'tu', 'mi', 'su', 'nos', 'te', 'me', 'es', 'en', 'del', 'al',
  'como', 'pero', 'mas', 'cuando', 'donde', 'quien', 'este', 'esta', 'ese',
  'esa', 'todo', 'toda', 'todos', 'nada', 'siempre', 'nunca', 'amor', 'vida',
  'corazon', 'tiempo', 'quiero', 'siento', 'puedo', 'quieres', 'vamos',
  'porque', 'solo', 'muy', 'asi', 'bien', 'mal', 'hoy', 'ayer', 'noche',
  'dia', 'ti', 'contigo', 'sin', 'ahora', 'aqui', 'alla', 'tan', 'tus'
])

/**
 * Detect the language of lyrics text
 * Returns 'es' for Spanish, 'en' for English (default)
 */
function detectLanguage(text: string, title: string): string {
  const combined = `${title} ${text}`.toLowerCase()

  // Check for Spanish-specific characters
  const hasSpanishChars = /[ñáéíóúü¿¡]/.test(combined)

  // Count Spanish word matches
  const words = combined.split(/[\s,.\-!?¿¡'"]+/).filter(w => w.length > 1)
  let spanishWordCount = 0

  for (const word of words) {
    if (SPANISH_WORDS.has(word)) {
      spanishWordCount++
    }
  }

  // Heuristic: if has Spanish chars or >15% Spanish words, mark as Spanish
  const spanishRatio = words.length > 0 ? spanishWordCount / words.length : 0

  if (hasSpanishChars || spanishRatio > 0.15) {
    return 'es'
  }

  return 'en'
}

/**
 * Get lyrics text from a file for language detection
 */
function getLyricsText(filePath: string): string {
  try {
    const { lyrics } = parseKarFile(filePath)
    return lyrics.map(line => line.text).join(' ')
  } catch {
    return ''
  }
}

export interface ScanProgress {
  total: number
  processed: number
  current: string
  added: number
  skipped: number
  errors: number
}

export interface ScanResult {
  total: number
  added: number
  skipped: number
  errors: number
  duration: number
}

/**
 * Get CDG file duration by reading the audio file
 * Returns duration in milliseconds, or 0 if unable to determine
 */
async function getCdgDuration(audioPath: string): Promise<number> {
  // For now, return 0 - actual duration will be determined at playback
  // A proper implementation would read the MP3 duration, but that requires
  // additional libraries. The duration isn't critical for catalog display.
  return 0
}

/**
 * Scan a directory for KAR, MIDI, and CDG files
 */
export async function scanCatalogDirectory(
  directoryPath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const startTime = Date.now()

  // Find all karaoke files (MIDI, KAR, CDG+MP3)
  const files = findKaraokeFiles(directoryPath)

  const result: ScanResult = {
    total: files.length,
    added: 0,
    skipped: 0,
    errors: 0,
    duration: 0
  }

  console.log(`Found ${files.length} karaoke files to scan (MIDI/KAR/CDG)`)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const filePath = file.path

    try {
      // Check if file already exists in database
      const existing = catalogDb.getSongByPath(filePath)

      if (existing) {
        // Check if file has been modified
        const currentHash = getFileHash(filePath)

        if (existing.file_hash === currentHash) {
          result.skipped++

          if (onProgress) {
            onProgress({
              total: files.length,
              processed: i + 1,
              current: path.basename(filePath),
              added: result.added,
              skipped: result.skipped,
              errors: result.errors
            })
          }
          continue
        }
      }

      // Extract artist and title from filename (common format: "Artist - Title.ext")
      const ext = path.extname(filePath)
      const baseFilename = path.basename(filePath, ext)
      let artist = ''
      let title = baseFilename

      const filenameMatch = baseFilename.match(/^(.+?)\s*-\s*(.+)$/)
      if (filenameMatch) {
        artist = filenameMatch[1].trim()
        title = filenameMatch[2].trim()
      }

      if (file.type === 'midi') {
        // Parse MIDI/KAR file for metadata
        const metadata = getSongMetadata(filePath)
        title = metadata.title || title

        // Detect language from lyrics and title
        const lyricsText = getLyricsText(filePath)
        const language = detectLanguage(lyricsText, title)

        // Add to database
        catalogDb.addSong({
          file_path: filePath,
          title,
          artist,
          duration_ms: metadata.duration,
          has_lyrics: metadata.hasLyrics,
          track_count: metadata.trackCount,
          file_hash: getFileHash(filePath),
          language,
          file_type: 'midi',
          audio_path: null,
          video_url: null
        })
      } else if (file.type === 'cdg') {
        // CDG files have graphics, not parseable lyrics
        // Duration would come from the audio file
        const duration = await getCdgDuration(file.audioPath!)

        catalogDb.addSong({
          file_path: filePath,
          title,
          artist,
          duration_ms: duration,
          has_lyrics: true, // CDG files always have visual lyrics
          track_count: 0,
          file_hash: getFileHash(filePath),
          language: 'en', // Default language for CDG (can't detect from graphics)
          file_type: 'cdg',
          audio_path: file.audioPath || null,
          video_url: null
        })
      }

      result.added++
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error)
      result.errors++
    }

    if (onProgress) {
      onProgress({
        total: files.length,
        processed: i + 1,
        current: path.basename(filePath),
        added: result.added,
        skipped: result.skipped,
        errors: result.errors
      })
    }

    // Yield to event loop occasionally to prevent blocking
    if (i % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  result.duration = Date.now() - startTime

  console.log(`Scan complete: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors in ${result.duration}ms`)

  return result
}

/**
 * Recursively find all MIDI, KAR, and CDG files in a directory
 * CDG files are only included if they have a matching MP3 file
 * MIDI/KAR files take precedence over CDG files with the same base name
 */
function findKaraokeFiles(directoryPath: string): ScannedFile[] {
  const midiFiles: ScannedFile[] = []
  const cdgFiles: Map<string, { cdgPath: string; mp3Path?: string }> = new Map()
  const midiBasenames: Set<string> = new Set() // Track MIDI/KAR base names to avoid duplicates

  const midiExtensions = ['.kar', '.mid', '.midi']
  const audioExtensions = ['.mp3', '.ogg', '.wav', '.m4a']

  function scan(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const directoryFiles: Map<string, string[]> = new Map() // basename -> [full paths]

      // First pass: collect all files by their base name
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // Skip hidden directories
          if (!entry.name.startsWith('.')) {
            scan(fullPath)
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          const baseName = path.basename(entry.name, ext).toLowerCase()

          if (!directoryFiles.has(baseName)) {
            directoryFiles.set(baseName, [])
          }
          directoryFiles.get(baseName)!.push(fullPath)
        }
      }

      // Second pass: process files by base name
      for (const [baseName, files] of directoryFiles) {
        let hasMidi = false
        let cdgPath: string | null = null
        let audioPath: string | null = null

        for (const filePath of files) {
          const ext = path.extname(filePath).toLowerCase()

          if (midiExtensions.includes(ext)) {
            // Found a MIDI/KAR file - add it directly
            midiFiles.push({ path: filePath, type: 'midi' })
            midiBasenames.add(baseName)
            hasMidi = true
          } else if (ext === '.cdg') {
            cdgPath = filePath
          } else if (audioExtensions.includes(ext)) {
            audioPath = filePath
          }
        }

        // If we have CDG + audio but no MIDI, track it
        if (!hasMidi && cdgPath && audioPath) {
          cdgFiles.set(baseName, { cdgPath, mp3Path: audioPath })
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error)
    }
  }

  scan(directoryPath)

  // Add CDG files that don't have MIDI equivalents
  for (const [baseName, { cdgPath, mp3Path }] of cdgFiles) {
    if (!midiBasenames.has(baseName) && mp3Path) {
      midiFiles.push({ path: cdgPath, type: 'cdg', audioPath: mp3Path })
    }
  }

  return midiFiles
}

// Legacy function for backward compatibility
function findMidiFiles(directoryPath: string): string[] {
  return findKaraokeFiles(directoryPath).map(f => f.path)
}

/**
 * Calculate MD5 hash of a file for change detection
 */
function getFileHash(filePath: string): string {
  try {
    const buffer = fs.readFileSync(filePath)
    return crypto.createHash('md5').update(buffer).digest('hex')
  } catch {
    return ''
  }
}

/**
 * Validate that a path is a valid directory
 */
export function validateCatalogPath(directoryPath: string): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(directoryPath)) {
      return { valid: false, error: 'Directory does not exist' }
    }

    const stats = fs.statSync(directoryPath)
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' }
    }

    // Check if readable
    fs.accessSync(directoryPath, fs.constants.R_OK)

    return { valid: true }
  } catch (error) {
    return { valid: false, error: `Cannot access directory: ${error}` }
  }
}

/**
 * Quick count of MIDI files in a directory (non-recursive for speed)
 */
export function countMidiFiles(directoryPath: string): number {
  return findMidiFiles(directoryPath).length
}
