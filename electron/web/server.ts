import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import { networkInterfaces } from 'os'
import QRCode from 'qrcode'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { catalogDb } from '../catalog/database.js'
import { settingsStore, type Settings } from '../settings/store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Soundfont directory path
function getSoundfontDir(): string {
  // __dirname is dist-electron in dev, so go up one level to project root
  const devPath = path.join(__dirname, '../soundfonts')
  if (fs.existsSync(devPath)) return devPath
  // In packaged app: resources/soundfonts
  return path.join(process.resourcesPath || __dirname, 'soundfonts')
}

// List available soundfonts
export function listSoundfonts(): Array<{ id: string; name: string; type: 'local' | 'cdn' }> {
  const soundfonts: Array<{ id: string; name: string; type: 'local' | 'cdn' }> = [
    { id: 'cdn:FluidR3_GM', name: 'FluidR3 GM', type: 'cdn' },
    { id: 'cdn:MusyngKite', name: 'MusyngKite', type: 'cdn' }
  ]

  const dir = getSoundfontDir()
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.sf2'))
    for (const file of files) {
      const name = file.replace(/\.sf2$/i, '')
      soundfonts.push({ id: `local:${file}`, name, type: 'local' })
    }
  }

  return soundfonts
}

// Load .env file from project root
// In dev: __dirname is dist-electron, so go up one level
// In packaged app: same logic applies
config({ path: path.join(__dirname, '../.env') })

const app = express()
app.use(express.json())

// Serve soundfont files
app.get('/soundfont/:filename', (req, res) => {
  const filename = req.params.filename
  // Security: only allow .sf2 files and prevent path traversal
  if (!filename.endsWith('.sf2') || filename.includes('..') || filename.includes('/')) {
    return res.status(400).send('Invalid filename')
  }

  const soundfontPath = path.join(getSoundfontDir(), filename)
  if (!fs.existsSync(soundfontPath)) {
    return res.status(404).send('Soundfont not found')
  }

  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
  res.sendFile(soundfontPath)
})

// Store WebSocket clients for broadcasting
const wsClients: WebSocket[] = []

// Callback for when queue is modified via web API
// This allows main process to also trigger Electron window updates and auto-play
let onQueueModifiedCallback: ((queue: unknown) => void) | null = null

export function onQueueModified(callback: (queue: unknown) => void): void {
  onQueueModifiedCallback = callback
}

// Callback for when settings are modified via web API
// This allows main process to send IPC updates to Electron windows
let onSettingsChangedCallback: ((key: string, value: unknown) => void) | null = null

export function onSettingsChanged(callback: (key: string, value: unknown) => void): void {
  onSettingsChangedCallback = callback
}

// Callbacks for playback control from web API
let playbackControlCallbacks: {
  play?: () => void
  pause?: () => void
  stop?: () => void
  skip?: () => void
  seek?: (timeMs: number) => void
  removeFromQueue?: (queueId: number) => void
} = {}

export function onPlaybackControl(callbacks: typeof playbackControlCallbacks): void {
  playbackControlCallbacks = { ...playbackControlCallbacks, ...callbacks }
}

// Get local network IP
function getLocalIP(): string {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Skip internal and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return 'localhost'
}

// API Routes
app.get('/api/songs', (req, res) => {
  const query = (req.query.q as string) || ''
  const lang = req.query.lang as string
  const hasLyrics = req.query.hasLyrics === 'true'
  const hasVideo = req.query.hasVideo === 'true'
  const filters = { hasLyrics, hasVideo }

  try {
    let songs
    if (lang && (lang === 'en' || lang === 'es')) {
      // For language-specific search, we need to add filter support
      // For now, apply filters post-search (could be optimized later)
      songs = catalogDb.searchSongsByLanguage(query, lang)
      if (hasLyrics) {
        songs = songs.filter(s => s.has_lyrics)
      }
      if (hasVideo) {
        songs = songs.filter(s => s.video_url)
      }
    } else {
      songs = catalogDb.searchSongs(query, 100, filters)
    }
    res.json(songs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to search songs' })
  }
})

app.get('/api/queue', (_req, res) => {
  try {
    const queue = catalogDb.getQueue()
    res.json(queue)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get queue' })
  }
})

app.get('/api/popular', (req, res) => {
  const lang = req.query.lang as string
  const hasLyrics = req.query.hasLyrics === 'true'
  const hasVideo = req.query.hasVideo === 'true'

  try {
    let songs
    if (lang && (lang === 'en' || lang === 'es')) {
      songs = catalogDb.getPopularByLanguage(lang, 20)
    } else {
      songs = catalogDb.getPopularSongs(20)
    }
    // Apply filters
    if (hasLyrics) {
      songs = songs.filter(s => s.has_lyrics)
    }
    if (hasVideo) {
      songs = songs.filter(s => s.video_url)
    }
    res.json(songs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get popular songs' })
  }
})

app.get('/api/discover', (req, res) => {
  const lang = req.query.lang as string
  const hasLyrics = req.query.hasLyrics === 'true'
  const hasVideo = req.query.hasVideo === 'true'

  try {
    let songs
    if (lang && (lang === 'en' || lang === 'es')) {
      songs = catalogDb.getRandomByLanguage(lang, 20)
    } else {
      songs = catalogDb.getRandomSongs(20)
    }
    // Apply filters
    if (hasLyrics) {
      songs = songs.filter(s => s.has_lyrics)
    }
    if (hasVideo) {
      songs = songs.filter(s => s.video_url)
    }
    res.json(songs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get random songs' })
  }
})

app.get('/api/languages', (_req, res) => {
  try {
    const counts = catalogDb.getLanguageCounts()
    res.json(counts)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get language counts' })
  }
})

app.post('/api/queue', (req, res) => {
  const { songId, singerName } = req.body
  if (!songId || !singerName) {
    return res.status(400).json({ error: 'songId and singerName are required' })
  }
  try {
    const queueId = catalogDb.addToQueue(songId, singerName)
    const queue = catalogDb.getQueue()
    // Broadcast queue update to all WebSocket clients
    broadcastQueue(queue)
    // Notify main process to update Electron windows and trigger auto-play
    if (onQueueModifiedCallback) {
      onQueueModifiedCallback(queue)
    }
    res.json({ success: true, queueId })
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to queue' })
  }
})

// Preview endpoint - returns first 15 seconds of MIDI notes
app.get('/api/preview/:songId', (req, res) => {
  const songId = parseInt(req.params.songId)
  if (isNaN(songId)) {
    return res.status(400).json({ error: 'Invalid song ID' })
  }

  try {
    const song = catalogDb.getSong(songId)
    if (!song) {
      return res.status(404).json({ error: 'Song not found' })
    }

    // Import parser dynamically to get preview notes
    import('../midi/parser.js').then(({ parseKarFileComplete }) => {
      try {
        const parsed = parseKarFileComplete(song.file_path)
        // Get first 15 seconds of notes
        const previewDuration = 15000 // 15 seconds in ms
        const previewNotes = parsed.tracks
          .flatMap(track => track.notes)
          .filter(note => note.time * 1000 < previewDuration)
          .map(note => ({
            time: Math.round(note.time * 1000), // Convert to ms
            duration: Math.round(note.duration * 1000),
            midi: note.midi,
            // @tonejs/midi stores velocity as 0-1, convert to 0-127
            velocity: Math.round(note.velocity * 127)
          }))
          // Sort by time ascending, then by midi note descending for chords
          .sort((a, b) => a.time - b.time || b.midi - a.midi)

        res.json({
          notes: previewNotes,
          duration: Math.min(previewDuration, parsed.duration * 1000)
        })
      } catch (parseError) {
        console.error('Preview parse error:', parseError)
        res.status(500).json({ error: 'Failed to parse song' })
      }
    }).catch(err => {
      console.error('Import error:', err)
      res.status(500).json({ error: 'Failed to load parser' })
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get preview' })
  }
})

// Serve audio files for CDG playback
app.get('/api/audio/:songId', (req, res) => {
  const songId = parseInt(req.params.songId)
  if (isNaN(songId)) {
    return res.status(400).json({ error: 'Invalid song ID' })
  }

  try {
    const song = catalogDb.getSong(songId)
    if (!song) {
      return res.status(404).json({ error: 'Song not found' })
    }

    // Only serve audio for CDG files
    if (song.file_type !== 'cdg' || !song.audio_path) {
      return res.status(400).json({ error: 'Song does not have audio file' })
    }

    if (!fs.existsSync(song.audio_path)) {
      return res.status(404).json({ error: 'Audio file not found' })
    }

    // Determine content type from extension
    const ext = path.extname(song.audio_path).toLowerCase()
    const contentTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4'
    }
    const contentType = contentTypes[ext] || 'audio/mpeg'

    // Support range requests for seeking
    const stat = fs.statSync(song.audio_path)
    const range = req.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
      const chunkSize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      })

      fs.createReadStream(song.audio_path, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      })

      fs.createReadStream(song.audio_path).pipe(res)
    }
  } catch (error) {
    console.error('Error serving audio:', error)
    res.status(500).json({ error: 'Failed to serve audio' })
  }
})

// Admin Portal API Endpoints

// Get all settings
app.get('/api/admin/settings', (_req, res) => {
  res.json(settingsStore.getAll())
})

// Update a single setting
app.put('/api/admin/settings/:key', (req, res) => {
  const key = req.params.key as keyof Settings
  const allSettings = settingsStore.getAll()

  if (!(key in allSettings)) {
    return res.status(400).json({ error: `Unknown setting: ${key}` })
  }

  const { value } = req.body
  settingsStore.set(key, value)

  // Broadcast change to all WebSocket clients
  const message = JSON.stringify({ type: 'settings', key, value })
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })

  // Notify main process to update Electron windows via IPC
  if (onSettingsChangedCallback) {
    onSettingsChangedCallback(key, value)
  }

  res.json({ success: true, key, value })
})

// List available MIDI outputs (needs IPC to main process)
app.get('/api/admin/midi-outputs', async (_req, res) => {
  try {
    // This returns cached info from the midi module
    const { listMidiOutputs } = await import('../midi/output.js')
    const outputs = listMidiOutputs()
    res.json(outputs)
  } catch (error) {
    res.status(500).json({ error: 'Failed to list MIDI outputs' })
  }
})

// List available soundfonts
app.get('/api/admin/soundfonts', (_req, res) => {
  res.json(listSoundfonts())
})

// Validate a file or directory path
app.post('/api/admin/validate-path', (req, res) => {
  const { path: pathToValidate, type } = req.body

  if (!pathToValidate) {
    return res.status(400).json({ valid: false, error: 'Path is required' })
  }

  try {
    const exists = fs.existsSync(pathToValidate)
    if (!exists) {
      return res.json({ valid: false, error: 'Path does not exist' })
    }

    const stats = fs.statSync(pathToValidate)
    if (type === 'directory' && !stats.isDirectory()) {
      return res.json({ valid: false, error: 'Path is not a directory' })
    }
    if (type === 'file' && !stats.isFile()) {
      return res.json({ valid: false, error: 'Path is not a file' })
    }

    res.json({ valid: true })
  } catch (error) {
    res.json({ valid: false, error: 'Failed to validate path' })
  }
})

// Get catalog stats
app.get('/api/admin/catalog/stats', (_req, res) => {
  try {
    const count = catalogDb.getSongCount()
    res.json({ songCount: count })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get catalog stats' })
  }
})

// Cleanup missing songs from catalog
app.post('/api/admin/catalog/cleanup', (_req, res) => {
  try {
    const result = catalogDb.cleanupMissingSongs()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: 'Failed to cleanup catalog' })
  }
})

// Reload database from disk
app.post('/api/admin/catalog/reload', (_req, res) => {
  try {
    catalogDb.reload()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to reload database' })
  }
})

// Playback control endpoints for admin portal
app.post('/api/admin/playback/play', (_req, res) => {
  if (playbackControlCallbacks.play) {
    playbackControlCallbacks.play()
    res.json({ success: true })
  } else {
    res.status(503).json({ error: 'Playback control not available' })
  }
})

app.post('/api/admin/playback/pause', (_req, res) => {
  if (playbackControlCallbacks.pause) {
    playbackControlCallbacks.pause()
    res.json({ success: true })
  } else {
    res.status(503).json({ error: 'Playback control not available' })
  }
})

app.post('/api/admin/playback/stop', (_req, res) => {
  if (playbackControlCallbacks.stop) {
    playbackControlCallbacks.stop()
    res.json({ success: true })
  } else {
    res.status(503).json({ error: 'Playback control not available' })
  }
})

app.post('/api/admin/playback/skip', (_req, res) => {
  if (playbackControlCallbacks.skip) {
    playbackControlCallbacks.skip()
    res.json({ success: true })
  } else {
    res.status(503).json({ error: 'Playback control not available' })
  }
})

app.post('/api/admin/playback/seek', (req, res) => {
  const { timeMs } = req.body
  if (typeof timeMs !== 'number') {
    return res.status(400).json({ error: 'timeMs is required' })
  }
  if (playbackControlCallbacks.seek) {
    playbackControlCallbacks.seek(timeMs)
    res.json({ success: true })
  } else {
    res.status(503).json({ error: 'Playback control not available' })
  }
})

// Queue management for admin portal
app.delete('/api/admin/queue/:queueId', (req, res) => {
  const queueId = parseInt(req.params.queueId)
  if (isNaN(queueId)) {
    return res.status(400).json({ error: 'Invalid queue ID' })
  }
  if (playbackControlCallbacks.removeFromQueue) {
    playbackControlCallbacks.removeFromQueue(queueId)
    res.json({ success: true })
  } else {
    res.status(503).json({ error: 'Queue control not available' })
  }
})

// Serve admin portal
app.get('/admin', (_req, res) => {
  res.send(getAdminPortalHTML())
})

// Serve mobile web app
app.get('/', (_req, res) => {
  res.send(getMobileAppHTML())
})

// Broadcast queue to all WebSocket clients
export function broadcastQueue(queue: unknown) {
  const message = JSON.stringify({ type: 'queue', data: queue })
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

// Broadcast playback state to all WebSocket clients
export function broadcastPlayback(state: unknown) {
  const message = JSON.stringify({ type: 'playback', data: state })
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

// Start the server
let server: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null
let serverPort = 3333
let qrCodeDataUrl: string | null = null
let wifiQrCodeDataUrl: string | null = null

// Generate WiFi QR code from environment variables
async function generateWifiQRCode(): Promise<string | null> {
  const ssid = process.env.WIFI_SSID
  const password = process.env.WIFI_PASSWORD
  const security = process.env.WIFI_SECURITY || 'WPA'

  if (!ssid) {
    console.log('WiFi QR code: WIFI_SSID not set in .env')
    return null
  }

  // WiFi QR code format: WIFI:T:WPA;S:ssid;P:password;;
  const wifiString = `WIFI:T:${security};S:${ssid};P:${password || ''};;`

  try {
    return await QRCode.toDataURL(wifiString, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    })
  } catch (error) {
    console.error('Failed to generate WiFi QR code:', error)
    return null
  }
}

export async function startWebServer(): Promise<{ url: string; qrCode: string }> {
  return new Promise((resolve, reject) => {
    server = createServer(app)

    // Setup WebSocket
    wss = new WebSocketServer({ server })
    wss.on('connection', (ws) => {
      wsClients.push(ws)
      // Send current queue on connect
      try {
        const queue = catalogDb.getQueue()
        ws.send(JSON.stringify({ type: 'queue', data: queue }))
      } catch (e) {
        // Ignore if db not ready
      }
      ws.on('close', () => {
        const index = wsClients.indexOf(ws)
        if (index > -1) wsClients.splice(index, 1)
      })
    })

    server.listen(serverPort, '0.0.0.0', async () => {
      const localIP = getLocalIP()
      const url = `http://${localIP}:${serverPort}`
      console.log(`Guest web app running at ${url}`)

      try {
        qrCodeDataUrl = await QRCode.toDataURL(url, {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        })
        // Also generate WiFi QR code
        wifiQrCodeDataUrl = await generateWifiQRCode()
        resolve({ url, qrCode: qrCodeDataUrl })
      } catch (error) {
        reject(error)
      }
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        serverPort++
        server?.close()
        startWebServer().then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })
  })
}

export function getQRCode(): string | null {
  return qrCodeDataUrl
}

export function getWifiQRCode(): string | null {
  return wifiQrCodeDataUrl
}

export function getWifiSSID(): string | null {
  return process.env.WIFI_SSID || null
}

export function stopWebServer() {
  wsClients.forEach(client => client.close())
  wsClients.length = 0
  wss?.close()
  server?.close()
}

// Mobile-friendly HTML app
function getMobileAppHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Karaoke Queue</title>
  <script src="https://unpkg.com/soundfont-player@0.12.0/dist/soundfont-player.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
      min-height: 100vh;
      padding: 16px;
      padding-bottom: 80px;
    }
    .header {
      text-align: center;
      padding: 20px 0;
    }
    .header h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }
    .header p {
      color: #888;
      font-size: 14px;
    }
    .search-box {
      position: sticky;
      top: 0;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 12px 0;
      z-index: 10;
    }
    .search-input {
      width: 100%;
      padding: 14px 16px;
      font-size: 16px;
      border: none;
      border-radius: 12px;
      background: #2a2a4e;
      color: white;
      outline: none;
    }
    .search-input::placeholder { color: #666; }
    .section-title {
      font-size: 14px;
      color: #888;
      margin: 20px 0 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title .icon { font-size: 16px; }
    .song-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .song-item {
      background: #2a2a4e;
      padding: 12px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .song-item-info {
      flex: 1;
      min-width: 0;
    }
    .song-title {
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .song-artist {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #3a3a6e;
      color: white;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .preview-btn:active {
      background: #4a4a8e;
    }
    .preview-btn.playing {
      background: #e74c3c;
    }
    .queue-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #4CAF50;
      color: white;
      font-size: 20px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .queue-btn:active {
      background: #45a049;
    }
    .queue-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #2a2a4e;
      padding: 12px 16px;
      border-radius: 12px;
    }
    .queue-item.playing {
      background: #1e3a5f;
      border-left: 3px solid #4CAF50;
    }
    .queue-number {
      font-size: 16px;
      font-weight: bold;
      color: #666;
      min-width: 24px;
      text-align: center;
    }
    .queue-info { flex: 1; min-width: 0; }
    .queue-singer {
      font-size: 12px;
      color: #4dabf7;
    }
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #2a2a4e;
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 320px;
    }
    .modal h2 {
      font-size: 18px;
      margin-bottom: 8px;
    }
    .modal p {
      color: #888;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .modal input {
      width: 100%;
      padding: 14px 16px;
      font-size: 16px;
      border: none;
      border-radius: 12px;
      background: #1a1a2e;
      color: white;
      margin-bottom: 16px;
    }
    .modal-buttons {
      display: flex;
      gap: 12px;
    }
    .modal-buttons button {
      flex: 1;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-cancel {
      background: #444;
      color: white;
    }
    .btn-confirm {
      background: #4CAF50;
      color: white;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #666;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #4CAF50;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      transition: transform 0.3s;
      z-index: 200;
    }
    .toast.show { transform: translateX(-50%) translateY(0); }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .tab {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 8px;
      background: #2a2a4e;
      color: #888;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab.active {
      background: #4a4a8e;
      color: white;
    }
    .horizontal-scroll {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding: 4px 0 16px;
      -webkit-overflow-scrolling: touch;
    }
    .horizontal-scroll::-webkit-scrollbar { display: none; }
    .song-card {
      flex-shrink: 0;
      width: 140px;
      background: #2a2a4e;
      border-radius: 12px;
      padding: 12px;
      cursor: pointer;
    }
    .song-card:active { opacity: 0.8; }
    .song-card .song-title {
      font-size: 13px;
      margin-bottom: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: normal;
    }
    .song-card .song-artist {
      font-size: 11px;
    }
    .lang-filter {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      padding: 0 4px;
    }
    .lang-btn {
      flex: 1;
      padding: 10px 12px;
      border: none;
      border-radius: 20px;
      background: #2a2a4e;
      color: #888;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .lang-btn.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .lang-btn:active {
      transform: scale(0.98);
    }
    .filter-row {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .filter-btn {
      padding: 8px 14px;
      border: none;
      border-radius: 20px;
      background: #2a2a4e;
      color: #888;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .filter-btn.active {
      background: #4a4a8e;
      color: white;
    }
    .filter-btn.lyrics.active {
      background: #2d8a4e;
    }
    .filter-btn.video.active {
      background: #c0392b;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎤 Karaoke Queue</h1>
    <p>Search for a song and add it to the queue</p>
  </div>

  <div class="search-box">
    <input type="text" class="search-input" id="searchInput" placeholder="Search songs..." autocomplete="off">
  </div>

  <div class="lang-filter">
    <button class="lang-btn active" id="langAll" onclick="setLanguage('')">All</button>
    <button class="lang-btn" id="langEn" onclick="setLanguage('en')">English</button>
    <button class="lang-btn" id="langEs" onclick="setLanguage('es')">Espanol</button>
  </div>

  <div class="filter-row">
    <button class="filter-btn lyrics" id="filterLyrics" onclick="toggleFilter('lyrics')">🎤 Has Lyrics</button>
    <button class="filter-btn video" id="filterVideo" onclick="toggleFilter('video')">▶️ Has Video</button>
  </div>

  <div id="homeSection">
    <!-- Queue Section -->
    <div id="queueSection">
      <div class="section-title"><span class="icon">📋</span> Queue</div>
      <div class="song-list" id="queueList">
        <div class="empty-state">Queue is empty - add some songs!</div>
      </div>
    </div>

    <!-- Popular Section -->
    <div id="popularSection">
      <div class="section-title"><span class="icon">🔥</span> Most Popular</div>
      <div class="horizontal-scroll" id="popularList"></div>
    </div>

    <!-- Discover Section -->
    <div id="discoverSection">
      <div class="section-title"><span class="icon">✨</span> Discover</div>
      <div class="horizontal-scroll" id="discoverList"></div>
    </div>
  </div>

  <div id="resultsSection" style="display: none;">
    <div class="section-title"><span class="icon">🔍</span> Search Results</div>
    <div class="song-list" id="resultsList"></div>
  </div>

  <div class="modal-overlay" id="modal">
    <div class="modal">
      <h2 id="modalTitle">Add to Queue</h2>
      <p id="modalSong">Song name here</p>
      <input type="text" id="singerInput" placeholder="Your name">
      <div class="modal-buttons">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-confirm" onclick="confirmAdd()">Add to Queue</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Added to queue!</div>

  <script>
    let selectedSong = null;
    let ws = null;
    let currentLanguage = '';
    let filterLyrics = false;
    let filterVideo = false;

    // WebSocket connection
    function connectWS() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'queue') {
          renderQueue(msg.data);
        }
      };
      ws.onclose = () => setTimeout(connectWS, 2000);
    }
    connectWS();

    // Language filter
    function setLanguage(lang) {
      currentLanguage = lang;
      // Update button states
      document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active'));
      if (lang === 'en') document.getElementById('langEn').classList.add('active');
      else if (lang === 'es') document.getElementById('langEs').classList.add('active');
      else document.getElementById('langAll').classList.add('active');

      // Refresh content with new language
      loadHomeContent();

      // If searching, refresh search results
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        searchSongs(query);
      }
    }

    function getLangParam() {
      return currentLanguage ? '&lang=' + currentLanguage : '';
    }

    function getFilterParams() {
      let params = '';
      if (filterLyrics) params += '&hasLyrics=true';
      if (filterVideo) params += '&hasVideo=true';
      return params;
    }

    function toggleFilter(type) {
      if (type === 'lyrics') {
        filterLyrics = !filterLyrics;
        document.getElementById('filterLyrics').classList.toggle('active', filterLyrics);
      } else if (type === 'video') {
        filterVideo = !filterVideo;
        document.getElementById('filterVideo').classList.toggle('active', filterVideo);
      }

      // Refresh content with new filters
      loadHomeContent();

      // If searching, refresh search results
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        searchSongs(query);
      }
    }

    // Search functionality
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = searchInput.value.trim();
      if (query.length < 2) {
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('homeSection').style.display = 'block';
        return;
      }
      searchTimeout = setTimeout(() => searchSongs(query), 300);
    });

    async function searchSongs(query) {
      try {
        const res = await fetch('/api/songs?q=' + encodeURIComponent(query) + getLangParam() + getFilterParams());
        const songs = await res.json();
        renderResults(songs);
      } catch (e) {
        console.error('Search failed:', e);
      }
    }

    function renderSongItem(song) {
      return '<div class="song-item">' +
        '<button class="preview-btn" id="preview-' + song.id + '" onclick="togglePreview(' + song.id + ', event)" title="Preview">▶</button>' +
        '<div class="song-item-info">' +
          '<div class="song-title">' + escapeHtml(song.title) + '</div>' +
          '<div class="song-artist">' + escapeHtml(song.artist || 'Unknown Artist') + '</div>' +
        '</div>' +
        '<button class="queue-btn" onclick="selectSong(' + song.id + ', \\'' + escapeHtml(song.title).replace(/'/g, "\\\\'") + '\\')" title="Add to Queue">+</button>' +
      '</div>';
    }

    function renderSongCard(song) {
      return '<div class="song-card" onclick="selectSong(' + song.id + ', \\'' + escapeHtml(song.title).replace(/'/g, "\\\\'") + '\\')">' +
        '<div class="song-title">' + escapeHtml(song.title) + '</div>' +
        '<div class="song-artist">' + escapeHtml(song.artist || 'Unknown') + '</div>' +
      '</div>';
    }

    function renderResults(songs) {
      const list = document.getElementById('resultsList');
      document.getElementById('homeSection').style.display = 'none';
      document.getElementById('resultsSection').style.display = 'block';

      if (songs.length === 0) {
        list.innerHTML = '<div class="empty-state">No songs found</div>';
        return;
      }

      list.innerHTML = songs.slice(0, 50).map(renderSongItem).join('');
    }

    function renderQueue(queue) {
      const list = document.getElementById('queueList');
      const activeItems = queue.filter(q => q.status === 'playing' || q.status === 'pending');

      if (activeItems.length === 0) {
        list.innerHTML = '<div class="empty-state">Queue is empty - add some songs!</div>';
        return;
      }

      list.innerHTML = activeItems.map((item, i) =>
        '<div class="queue-item ' + (item.status === 'playing' ? 'playing' : '') + '">' +
          '<div class="queue-number">' + (item.status === 'playing' ? '▶' : (i + 1)) + '</div>' +
          '<div class="queue-info">' +
            '<div class="song-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="queue-singer">' + escapeHtml(item.singer_name) + '</div>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    function renderPopular(songs) {
      const list = document.getElementById('popularList');
      if (songs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="width:100%">No play history yet</div>';
        return;
      }
      list.innerHTML = songs.map(renderSongCard).join('');
    }

    function renderDiscover(songs) {
      const list = document.getElementById('discoverList');
      if (songs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="width:100%">No songs available</div>';
        return;
      }
      list.innerHTML = songs.map(renderSongCard).join('');
    }

    function selectSong(id, title) {
      selectedSong = { id, title };
      document.getElementById('modalSong').textContent = title;
      // Load cached name from localStorage
      const cachedName = localStorage.getItem('singerName') || '';
      document.getElementById('singerInput').value = cachedName;
      document.getElementById('modal').classList.add('active');
      if (!cachedName) {
        document.getElementById('singerInput').focus();
      }
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('active');
      selectedSong = null;
    }

    async function confirmAdd() {
      const singerName = document.getElementById('singerInput').value.trim();
      if (!singerName || !selectedSong) return;

      // Cache the name for next time
      localStorage.setItem('singerName', singerName);

      try {
        await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songId: selectedSong.id, singerName })
        });
        closeModal();
        searchInput.value = '';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('homeSection').style.display = 'block';
        showToast('Added to queue!');
      } catch (e) {
        console.error('Failed to add:', e);
      }
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    // Load home content (respects language and content filters)
    function loadHomeContent() {
      let query = '?';
      if (currentLanguage) query += 'lang=' + currentLanguage + '&';
      if (filterLyrics) query += 'hasLyrics=true&';
      if (filterVideo) query += 'hasVideo=true&';
      // Remove trailing & or ?
      query = query.replace(/[&?]$/, '');
      if (query === '?') query = '';

      fetch('/api/popular' + query).then(r => r.json()).then(renderPopular).catch(() => {});
      fetch('/api/discover' + query).then(r => r.json()).then(renderDiscover).catch(() => {});
    }

    // Load initial data
    fetch('/api/queue').then(r => r.json()).then(renderQueue).catch(() => {});
    loadHomeContent();

    // Audio Preview System with Soundfont (FluidR3_GM for better quality)
    let audioContext = null;
    let pianoPlayer = null;
    let currentPreviewId = null;
    let previewTimeouts = [];
    let activeNotes = [];
    let loadingPiano = false;

    async function getAudioContext() {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      // iOS Safari requires resume() from user gesture
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
          console.log('AudioContext resumed, state:', audioContext.state);
        } catch (e) {
          console.error('Failed to resume AudioContext:', e);
        }
      }
      return audioContext;
    }

    async function loadPiano() {
      if (pianoPlayer || loadingPiano) return pianoPlayer;
      loadingPiano = true;

      try {
        const ctx = await getAudioContext();
        console.log('Loading piano soundfont, AudioContext state:', ctx.state);
        pianoPlayer = await Soundfont.instrument(ctx, 'acoustic_grand_piano', {
          soundfont: 'FluidR3_GM',
          gain: 2.0
        });
        console.log('Piano soundfont loaded (FluidR3_GM)');
        return pianoPlayer;
      } catch (e) {
        console.error('Failed to load piano:', e);
        loadingPiano = false;
        return null;
      }
    }

    function stopPreview() {
      previewTimeouts.forEach(t => clearTimeout(t));
      previewTimeouts = [];

      // Stop all active notes
      activeNotes.forEach(note => {
        try { note.stop(); } catch(e) {}
      });
      activeNotes = [];

      if (currentPreviewId) {
        const btn = document.getElementById('preview-' + currentPreviewId);
        if (btn) {
          btn.classList.remove('playing');
          btn.textContent = '▶';
        }
        currentPreviewId = null;
      }
    }

    async function togglePreview(songId, event) {
      event.stopPropagation();

      // If already playing this song, stop it
      if (currentPreviewId === songId) {
        stopPreview();
        return;
      }

      // Stop any current preview
      stopPreview();

      const btn = document.getElementById('preview-' + songId);
      btn.classList.add('playing');
      btn.textContent = '⏹';
      currentPreviewId = songId;

      try {
        // Load piano if not already loaded
        const piano = await loadPiano();
        if (!piano) {
          throw new Error('Piano not loaded');
        }

        const res = await fetch('/api/preview/' + songId);
        if (!res.ok) throw new Error('Failed to load preview');

        const data = await res.json();
        const ctx = await getAudioContext();
        console.log('Playing preview, AudioContext state:', ctx.state);

        const audioStartTime = ctx.currentTime;

        // Schedule notes using soundfont player
        data.notes.forEach(note => {
          const noteStartTime = audioStartTime + (note.time / 1000);
          const noteDuration = Math.min(note.duration / 1000, 2);
          const gain = (note.velocity / 127) * 2.0;

          const playedNote = piano.play(note.midi, noteStartTime, {
            gain: gain,
            duration: noteDuration
          });
          activeNotes.push(playedNote);
        });

        // Auto-stop after preview duration
        const stopTimeout = setTimeout(() => {
          if (currentPreviewId === songId) {
            stopPreview();
          }
        }, data.duration + 500);
        previewTimeouts.push(stopTimeout);

      } catch (e) {
        console.error('Preview failed:', e);
        stopPreview();
        showToast('Preview failed: ' + (e.message || 'Unknown error'));
      }
    }

    // iOS silent mode bypass: playing an <audio> element switches to "Playback" mode
    // which ignores the silent switch (like YouTube does)
    function unlockiOSAudio() {
      // Create a short silent audio using a data URI (tiny MP3)
      const silentAudio = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+9DEAAAIAANIAAAAgAAA0gAAABBHq4SCCCEIEBASBEQFBQUFH/y4IBgbB8H/8QBg+D5//y4f/h/gh//+sHQfD/UC/1g//9YP+D4f8='
      );
      silentAudio.setAttribute('playsinline', 'true');
      silentAudio.play().then(() => {
        console.log('iOS audio unlocked (silent mode bypass)');
      }).catch(e => {
        console.log('iOS audio unlock skipped:', e.message);
      });
    }

    // Pre-load piano on first interaction (iOS needs this from user gesture)
    document.addEventListener('click', async () => {
      try {
        unlockiOSAudio(); // Bypass iOS silent mode
        await getAudioContext(); // Ensure context is resumed
        await loadPiano();
      } catch (e) {
        console.error('Failed to initialize audio:', e);
      }
    }, { once: true });
  </script>
</body>
</html>`
}

// Admin Portal HTML
function getAdminPortalHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Portal - MIDI Karaoke</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: white;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      color: #888;
      text-align: center;
      margin-bottom: 32px;
    }
    .section {
      background: #2a2a4e;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .section h2 {
      font-size: 18px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section h2 .icon { font-size: 20px; }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group:last-child {
      margin-bottom: 0;
    }
    label {
      display: block;
      font-size: 13px;
      color: #aaa;
      margin-bottom: 6px;
    }
    input[type="text"],
    input[type="number"],
    select {
      width: 100%;
      padding: 12px;
      font-size: 15px;
      border: 1px solid #3a3a6e;
      border-radius: 8px;
      background: #1a1a2e;
      color: white;
      outline: none;
    }
    input:focus, select:focus {
      border-color: #667eea;
    }
    .toggle-group {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #3a3a6e;
    }
    .toggle-group:last-child {
      border-bottom: none;
    }
    .toggle-label {
      font-size: 14px;
    }
    .toggle {
      position: relative;
      width: 50px;
      height: 28px;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background-color: #3a3a6e;
      border-radius: 28px;
      transition: 0.3s;
    }
    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      border-radius: 50%;
      transition: 0.3s;
    }
    .toggle input:checked + .toggle-slider {
      background-color: #4CAF50;
    }
    .toggle input:checked + .toggle-slider:before {
      transform: translateX(22px);
    }
    .btn {
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn:active { opacity: 0.8; }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-secondary {
      background: #3a3a6e;
      color: white;
    }
    .btn-danger {
      background: #c0392b;
      color: white;
    }
    .btn-row {
      display: flex;
      gap: 12px;
      margin-top: 12px;
    }
    .status {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .status-connected {
      background: #2d8a4e;
      color: white;
    }
    .status-disconnected {
      background: #c0392b;
      color: white;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #3a3a6e;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #667eea;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #4CAF50;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      transition: transform 0.3s;
      z-index: 200;
    }
    .toast.error { background: #c0392b; }
    .toast.show { transform: translateX(-50%) translateY(0); }
    .connection-status {
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #888;
    }
    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #c0392b;
    }
    .connection-dot.connected { background: #4CAF50; }
    .playback-controls {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-bottom: 16px;
    }
    .playback-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .playback-btn:hover { transform: scale(1.1); }
    .playback-btn:active { transform: scale(0.95); }
    .playback-btn.play { background: #4CAF50; color: white; }
    .playback-btn.pause { background: #ff9800; color: white; }
    .playback-btn.stop { background: #f44336; color: white; }
    .playback-btn.skip { background: #3a3a6e; color: white; }
    .now-playing {
      text-align: center;
      padding: 16px;
      background: #1e3a5f;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .now-playing .song-title {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .now-playing .singer {
      color: #4dabf7;
      font-size: 14px;
    }
    .now-playing .status {
      margin-top: 8px;
      font-size: 12px;
      color: #888;
    }
    .progress-bar {
      width: 100%;
      height: 8px;
      background: #3a3a6e;
      border-radius: 4px;
      margin: 12px 0;
      cursor: pointer;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 4px;
      transition: width 0.1s;
    }
    .progress-time {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #888;
    }
    .queue-list {
      max-height: 300px;
      overflow-y: auto;
    }
    .queue-item {
      display: flex;
      align-items: center;
      padding: 10px;
      background: #1a1a2e;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .queue-item.playing {
      background: #1e3a5f;
      border-left: 3px solid #4CAF50;
    }
    .queue-item .queue-info {
      flex: 1;
      min-width: 0;
    }
    .queue-item .queue-title {
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .queue-item .queue-singer {
      font-size: 12px;
      color: #4dabf7;
    }
    .queue-item .remove-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: #c0392b;
      color: white;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .queue-item .remove-btn:hover { opacity: 0.8; }
    .empty-queue {
      text-align: center;
      color: #666;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="connection-status">
    <div class="connection-dot" id="connectionDot"></div>
    <span id="connectionText">Connecting...</span>
  </div>

  <div class="container">
    <h1>Admin Portal</h1>
    <p class="subtitle">Configure MIDI Karaoke settings remotely</p>

    <!-- Playback Controls -->
    <div class="section">
      <h2><span class="icon">🎶</span> Now Playing</h2>
      <div class="now-playing" id="nowPlaying">
        <div class="song-title" id="nowPlayingTitle">No song playing</div>
        <div class="singer" id="nowPlayingSinger"></div>
        <div class="status" id="nowPlayingStatus">Stopped</div>
      </div>
      <div class="progress-bar" id="progressBar" onclick="seekTo(event)">
        <div class="progress-fill" id="progressFill" style="width: 0%"></div>
      </div>
      <div class="progress-time">
        <span id="currentTime">0:00</span>
        <span id="totalTime">0:00</span>
      </div>
      <div class="playback-controls">
        <button class="playback-btn stop" onclick="stopPlayback()" title="Stop">⏹</button>
        <button class="playback-btn play" id="playPauseBtn" onclick="togglePlayPause()" title="Play/Pause">▶</button>
        <button class="playback-btn skip" onclick="skipSong()" title="Skip">⏭</button>
      </div>
    </div>

    <!-- Queue -->
    <div class="section">
      <h2><span class="icon">📋</span> Queue</h2>
      <div class="queue-list" id="queueList">
        <div class="empty-queue">Queue is empty</div>
      </div>
    </div>

    <!-- Audio Settings -->
    <div class="section">
      <h2><span class="icon">🎵</span> Audio Settings</h2>
      <div class="form-group">
        <label>Soundfont</label>
        <select id="soundfontId">
          <option value="">Loading...</option>
        </select>
      </div>
    </div>

    <!-- MIDI Settings -->
    <div class="section">
      <h2><span class="icon">🎹</span> MIDI Settings</h2>
      <div class="form-group">
        <label>MIDI Output Device</label>
        <select id="midiOutputName">
          <option value="">None (Software Synth)</option>
        </select>
      </div>
      <div class="form-group">
        <label>MIDI Delay (ms)</label>
        <input type="number" id="midiDelayMs" min="0" max="500" step="10" value="0">
      </div>
    </div>

    <!-- Display Settings -->
    <div class="section">
      <h2><span class="icon">🖥️</span> Display Settings</h2>
      <div class="form-group">
        <label>Lyrics Mode</label>
        <select id="lyricsMode">
          <option value="normal">Normal</option>
          <option value="bouncing">Bouncing Ball</option>
        </select>
      </div>
      <div class="form-group">
        <label>Background Type</label>
        <select id="backgroundType">
          <option value="none">None</option>
          <option value="starfield">Starfield</option>
          <option value="matrix">Matrix</option>
          <option value="gradient">Gradient</option>
          <option value="visualizer">Visualizer</option>
          <option value="video">Video File</option>
          <option value="youtube">YouTube</option>
        </select>
      </div>
      <div class="form-group" id="videoPathGroup" style="display: none;">
        <label>Video File Path</label>
        <input type="text" id="backgroundVideoPath" placeholder="/path/to/video.mp4">
      </div>
      <div class="toggle-group">
        <span class="toggle-label">Enable YouTube Backgrounds</span>
        <label class="toggle">
          <input type="checkbox" id="youtubeBackgroundEnabled">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-group">
        <span class="toggle-label">Show WiFi QR Code</span>
        <label class="toggle">
          <input type="checkbox" id="showWifiQR">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Catalog Settings -->
    <div class="section">
      <h2><span class="icon">📁</span> Catalog</h2>
      <div class="form-group">
        <label>Catalog Path</label>
        <input type="text" id="catalogPath" placeholder="/path/to/karaoke/files">
      </div>
      <div class="stat-row">
        <span>Total Songs</span>
        <span class="stat-value" id="songCount">-</span>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="reloadDatabase()">Reload Database</button>
        <button class="btn btn-danger" onclick="cleanupCatalog()">Cleanup Missing</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Saved!</div>

  <script>
    let ws = null;
    let settings = {};
    let debounceTimers = {};
    let playbackState = { playing: false, paused: false, currentTime: 0, duration: 0 };
    let queue = [];

    // WebSocket connection for real-time sync
    function connectWS() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);

      ws.onopen = () => {
        document.getElementById('connectionDot').classList.add('connected');
        document.getElementById('connectionText').textContent = 'Connected';
      };

      ws.onclose = () => {
        document.getElementById('connectionDot').classList.remove('connected');
        document.getElementById('connectionText').textContent = 'Disconnected';
        setTimeout(connectWS, 2000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'settings') {
          settings[msg.key] = msg.value;
          updateFieldValue(msg.key, msg.value);
        } else if (msg.type === 'queue') {
          queue = msg.data || [];
          renderQueue();
          updateNowPlaying();
        } else if (msg.type === 'playback') {
          playbackState = msg.data || { playing: false, paused: false, currentTime: 0, duration: 0 };
          updateNowPlaying();
          updateProgress();
        }
      };
    }
    connectWS();

    // Playback control functions
    async function togglePlayPause() {
      try {
        if (playbackState.playing && !playbackState.paused) {
          await fetch('/api/admin/playback/pause', { method: 'POST' });
        } else {
          await fetch('/api/admin/playback/play', { method: 'POST' });
        }
      } catch (e) {
        showToast('Playback control failed', true);
      }
    }

    async function stopPlayback() {
      try {
        await fetch('/api/admin/playback/stop', { method: 'POST' });
        showToast('Stopped');
      } catch (e) {
        showToast('Stop failed', true);
      }
    }

    async function skipSong() {
      try {
        await fetch('/api/admin/playback/skip', { method: 'POST' });
        showToast('Skipped');
      } catch (e) {
        showToast('Skip failed', true);
      }
    }

    function seekTo(event) {
      const bar = document.getElementById('progressBar');
      const rect = bar.getBoundingClientRect();
      const percent = (event.clientX - rect.left) / rect.width;
      const timeMs = percent * playbackState.duration;

      fetch('/api/admin/playback/seek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMs })
      }).catch(() => showToast('Seek failed', true));
    }

    async function removeFromQueue(queueId) {
      try {
        await fetch('/api/admin/queue/' + queueId, { method: 'DELETE' });
        showToast('Removed from queue');
      } catch (e) {
        showToast('Remove failed', true);
      }
    }

    function formatTime(ms) {
      const seconds = Math.floor(ms / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return mins + ':' + secs.toString().padStart(2, '0');
    }

    function updateNowPlaying() {
      const playingItem = queue.find(q => q.status === 'playing');
      const titleEl = document.getElementById('nowPlayingTitle');
      const singerEl = document.getElementById('nowPlayingSinger');
      const statusEl = document.getElementById('nowPlayingStatus');
      const playBtn = document.getElementById('playPauseBtn');

      // Use playbackState to determine if something is actually playing
      const isPlaying = playbackState.playing && !playbackState.paused;
      const isPaused = playbackState.playing && playbackState.paused;

      if (playingItem || playbackState.playing) {
        titleEl.textContent = playingItem?.title || playbackState.songName || 'Unknown Song';
        singerEl.textContent = playingItem?.singer_name ? 'Singing: ' + playingItem.singer_name : (playbackState.singer ? 'Singing: ' + playbackState.singer : '');

        if (isPaused) {
          statusEl.textContent = 'Paused';
          playBtn.textContent = '▶';
          playBtn.classList.remove('pause');
          playBtn.classList.add('play');
        } else if (isPlaying) {
          statusEl.textContent = 'Playing';
          playBtn.textContent = '⏸';
          playBtn.classList.add('pause');
          playBtn.classList.remove('play');
        } else {
          statusEl.textContent = 'Stopped';
          playBtn.textContent = '▶';
          playBtn.classList.remove('pause');
          playBtn.classList.add('play');
        }
      } else {
        titleEl.textContent = 'No song playing';
        singerEl.textContent = '';
        statusEl.textContent = 'Stopped';
        playBtn.textContent = '▶';
        playBtn.classList.remove('pause');
        playBtn.classList.add('play');
      }
    }

    function updateProgress() {
      const percent = playbackState.duration > 0
        ? (playbackState.currentTime / playbackState.duration) * 100
        : 0;
      document.getElementById('progressFill').style.width = percent + '%';
      document.getElementById('currentTime').textContent = formatTime(playbackState.currentTime);
      document.getElementById('totalTime').textContent = formatTime(playbackState.duration);
    }

    function renderQueue() {
      const list = document.getElementById('queueList');
      const activeItems = queue.filter(q => q.status === 'playing' || q.status === 'pending');

      if (activeItems.length === 0) {
        list.innerHTML = '<div class="empty-queue">Queue is empty</div>';
        return;
      }

      list.innerHTML = activeItems.map(item =>
        '<div class="queue-item ' + (item.status === 'playing' ? 'playing' : '') + '">' +
          '<div class="queue-info">' +
            '<div class="queue-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="queue-singer">' + escapeHtml(item.singer_name) + '</div>' +
          '</div>' +
          (item.status !== 'playing' ?
            '<button class="remove-btn" onclick="removeFromQueue(' + item.id + ')" title="Remove">×</button>'
            : '') +
        '</div>'
      ).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    // Load queue on page load
    async function loadQueue() {
      try {
        const res = await fetch('/api/queue');
        queue = await res.json();
        renderQueue();
        updateNowPlaying();
      } catch (e) {
        console.error('Failed to load queue:', e);
      }
    }

    // Load initial data
    async function loadSettings() {
      try {
        const res = await fetch('/api/admin/settings');
        settings = await res.json();
        Object.entries(settings).forEach(([key, value]) => {
          updateFieldValue(key, value);
        });
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }

    async function loadMidiOutputs() {
      try {
        const res = await fetch('/api/admin/midi-outputs');
        const outputs = await res.json();
        const select = document.getElementById('midiOutputName');
        select.innerHTML = '<option value="">None (Software Synth)</option>';
        outputs.forEach(output => {
          const opt = document.createElement('option');
          opt.value = output.name;
          opt.textContent = output.name;
          select.appendChild(opt);
        });
        // Restore selection
        if (settings.midiOutputName) {
          select.value = settings.midiOutputName;
        }
      } catch (e) {
        console.error('Failed to load MIDI outputs:', e);
      }
    }

    async function loadSoundfonts() {
      try {
        const res = await fetch('/api/admin/soundfonts');
        const soundfonts = await res.json();
        const select = document.getElementById('soundfontId');
        select.innerHTML = '';
        soundfonts.forEach(sf => {
          const opt = document.createElement('option');
          opt.value = sf.id;
          opt.textContent = sf.name + (sf.type === 'cdn' ? ' (CDN)' : ' (Local)');
          select.appendChild(opt);
        });
        // Restore selection
        if (settings.soundfontId) {
          select.value = settings.soundfontId;
        }
      } catch (e) {
        console.error('Failed to load soundfonts:', e);
      }
    }

    async function loadCatalogStats() {
      try {
        const res = await fetch('/api/admin/catalog/stats');
        const stats = await res.json();
        document.getElementById('songCount').textContent = stats.songCount.toLocaleString();
      } catch (e) {
        console.error('Failed to load catalog stats:', e);
      }
    }

    function updateFieldValue(key, value) {
      const el = document.getElementById(key);
      if (!el) return;

      if (el.type === 'checkbox') {
        el.checked = !!value;
      } else {
        el.value = value ?? '';
      }

      // Show/hide video path field
      if (key === 'backgroundType') {
        document.getElementById('videoPathGroup').style.display =
          value === 'video' ? 'block' : 'none';
      }
    }

    // Save setting with debounce
    function saveSetting(key, value) {
      clearTimeout(debounceTimers[key]);
      debounceTimers[key] = setTimeout(async () => {
        try {
          const res = await fetch('/api/admin/settings/' + key, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value })
          });
          if (res.ok) {
            settings[key] = value;
            showToast('Saved!');
          } else {
            showToast('Save failed', true);
          }
        } catch (e) {
          console.error('Failed to save:', e);
          showToast('Save failed', true);
        }
      }, 300);
    }

    // Event listeners for all settings fields
    function setupEventListeners() {
      // Select fields
      ['soundfontId', 'midiOutputName', 'lyricsMode', 'backgroundType'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', () => {
            const value = el.value;
            saveSetting(id, value);

            // Show/hide video path
            if (id === 'backgroundType') {
              document.getElementById('videoPathGroup').style.display =
                value === 'video' ? 'block' : 'none';
            }
          });
        }
      });

      // Number/text fields
      ['midiDelayMs', 'backgroundVideoPath', 'catalogPath'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', () => {
            let value = el.value;
            if (el.type === 'number') {
              value = parseInt(value) || 0;
            }
            saveSetting(id, value);
          });
        }
      });

      // Toggle switches
      ['youtubeBackgroundEnabled', 'showWifiQR'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', () => {
            saveSetting(id, el.checked);
          });
        }
      });
    }

    async function reloadDatabase() {
      try {
        const res = await fetch('/api/admin/catalog/reload', { method: 'POST' });
        if (res.ok) {
          showToast('Database reloaded');
          loadCatalogStats();
        } else {
          showToast('Reload failed', true);
        }
      } catch (e) {
        showToast('Reload failed', true);
      }
    }

    async function cleanupCatalog() {
      if (!confirm('Remove songs with missing files from the catalog?')) return;

      try {
        const res = await fetch('/api/admin/catalog/cleanup', { method: 'POST' });
        const result = await res.json();
        showToast('Removed ' + result.removed + ' missing songs');
        loadCatalogStats();
      } catch (e) {
        showToast('Cleanup failed', true);
      }
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'toast' + (isError ? ' error' : '');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // Initialize
    loadSettings().then(() => {
      loadMidiOutputs();
      loadSoundfonts();
      loadCatalogStats();
      setupEventListeners();
    });
    loadQueue();
  </script>
</body>
</html>`
}
