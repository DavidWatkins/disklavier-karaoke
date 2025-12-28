#!/usr/bin/env node

/**
 * Auto-associate YouTube music videos with songs in the catalog.
 *
 * This script searches for YouTube music videos matching each song
 * and saves the video URLs to the database.
 *
 * Usage:
 *   npx tsx scripts/associate-youtube-videos.ts [options]
 *
 * Options:
 *   --dry-run     Preview matches without saving to database
 *   --limit=N     Only process N songs (default: all)
 *   --force       Re-process songs that already have video URLs
 *   --youtube-api Use YouTube Data API (requires YOUTUBE_API_KEY env var)
 *
 * By default, uses Invidious API (no API key needed, no quota limits).
 * With --youtube-api, uses the official YouTube API (100 searches/day free).
 */

import initSqlJs, { Database } from 'sql.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

// Parse command line arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const useYouTubeApi = args.includes('--youtube-api')
const limitArg = args.find(a => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY

// Piped public instances (fallback if one is down)
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.leptons.xyz',
]

let currentInstanceIndex = 0
let consecutiveFailures = 0

interface Song {
  id: number
  title: string
  artist: string
  video_url: string | null
}

interface SearchResult {
  videoId: string
  title: string
}

interface PipedVideo {
  url: string  // Format: /watch?v=VIDEO_ID
  title: string
  uploaderName: string
  type?: string
}

interface PipedSearchResponse {
  items: PipedVideo[]
}

// Extract video ID from Piped URL format
function extractPipedVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([^&]+)/)
  return match ? match[1] : null
}

// Search using Piped API (no API key needed)
async function searchPiped(query: string): Promise<SearchResult | null> {
  // Try each instance until one works
  for (let attempt = 0; attempt < PIPED_INSTANCES.length; attempt++) {
    const instance = PIPED_INSTANCES[(currentInstanceIndex + attempt) % PIPED_INSTANCES.length]
    const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000) // 15s timeout

      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!response.ok) {
        console.log(`  Instance ${instance} returned ${response.status}, trying next...`)
        continue
      }

      const data = await response.json() as PipedSearchResponse

      if (data.items && data.items.length > 0) {
        const video = data.items[0]
        const videoId = extractPipedVideoId(video.url)

        if (videoId) {
          // Update current instance to the working one
          currentInstanceIndex = (currentInstanceIndex + attempt) % PIPED_INSTANCES.length
          consecutiveFailures = 0
          return {
            videoId,
            title: video.title
          }
        }
      }

      return null
    } catch (error) {
      const errMsg = (error as Error).message
      if (errMsg.includes('abort')) {
        console.log(`  Instance ${instance} timed out, trying next...`)
      } else {
        console.log(`  Instance ${instance} failed: ${errMsg.slice(0, 50)}, trying next...`)
      }
      continue
    }
  }

  consecutiveFailures++
  if (consecutiveFailures >= 5) {
    console.error('  WARNING: 5 consecutive failures. APIs may be rate-limiting.')
    console.error('  Consider waiting a few minutes before continuing.')
  }
  return null
}

// Search using YouTube Data API (requires API key)
async function searchYouTubeApi(query: string): Promise<SearchResult | null> {
  if (!YOUTUBE_API_KEY) {
    console.error('  YouTube API key not set')
    return null
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', query)
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '1')
  url.searchParams.set('key', YOUTUBE_API_KEY)

  try {
    const response = await fetch(url.toString())
    const data = await response.json()

    if (data.error) {
      console.error(`  API Error: ${data.error.message}`)
      return null
    }

    if (data.items && data.items.length > 0) {
      const item = data.items[0]
      return {
        videoId: item.id.videoId,
        title: item.snippet.title
      }
    }
    return null
  } catch (error) {
    console.error(`  Network error: ${(error as Error).message}`)
    return null
  }
}

// Main search function - uses the selected method
async function searchForVideo(title: string, artist: string): Promise<SearchResult | null> {
  const query = `${title} ${artist} official music video`

  if (useYouTubeApi) {
    return searchYouTubeApi(query)
  } else {
    return searchPiped(query)
  }
}

function getDbPath(): string {
  // Try common Electron userData paths
  const possiblePaths = [
    // macOS
    path.join(os.homedir(), 'Library/Application Support/disklavier-karaoke/catalog.db'),
    // Linux
    path.join(os.homedir(), '.config/disklavier-karaoke/catalog.db'),
    // Windows
    path.join(os.homedir(), 'AppData/Roaming/disklavier-karaoke/catalog.db'),
    // Development - check if running from project root
    path.join(process.cwd(), 'catalog.db')
  ]

  for (const dbPath of possiblePaths) {
    if (fs.existsSync(dbPath)) {
      return dbPath
    }
  }

  // If not found, show helpful message
  console.error('Could not find catalog.db in common locations:')
  possiblePaths.forEach(p => console.error(`  - ${p}`))
  console.error('')
  console.error('Make sure you have run the app at least once to create the database.')
  process.exit(1)
}

async function main() {
  console.log('=== YouTube Video Auto-Association ===')
  console.log('')
  console.log(`Search method: ${useYouTubeApi ? 'YouTube Data API' : 'Piped API (no API key needed)'}`)

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be saved')
  }
  console.log('')

  if (useYouTubeApi && !YOUTUBE_API_KEY) {
    console.error('Error: --youtube-api requires YOUTUBE_API_KEY environment variable.')
    console.error('Set it with: export YOUTUBE_API_KEY=your_key_here')
    console.error('')
    console.error('Or run without --youtube-api to use web search (no API key needed).')
    process.exit(1)
  }

  // Find database
  const dbPath = getDbPath()
  console.log(`Database: ${dbPath}`)

  // Initialize sql.js
  const SQL = await initSqlJs()

  // Read database file
  const dbBuffer = fs.readFileSync(dbPath)
  const db: Database = new SQL.Database(dbBuffer)

  // Get songs to process
  let query = 'SELECT id, title, artist, video_url FROM songs'
  if (!force) {
    query += " WHERE video_url IS NULL OR video_url = ''"
  }
  query += ' ORDER BY title'

  const result = db.exec(query)
  if (result.length === 0) {
    console.log('No songs found to process.')
    db.close()
    return
  }

  const columns = result[0].columns
  const idIdx = columns.indexOf('id')
  const titleIdx = columns.indexOf('title')
  const artistIdx = columns.indexOf('artist')
  const videoUrlIdx = columns.indexOf('video_url')

  const songs: Song[] = result[0].values.map(row => ({
    id: row[idIdx] as number,
    title: row[titleIdx] as string,
    artist: row[artistIdx] as string,
    video_url: row[videoUrlIdx] as string | null
  }))

  const toProcess = songs.slice(0, limit)

  console.log(`Found ${songs.length} songs${force ? '' : ' without video URLs'}`)
  if (limit < songs.length) {
    console.log(`Processing first ${limit} songs (use --limit=N to change)`)
  }
  console.log('')

  let found = 0
  let notFound = 0
  let errors = 0

  for (let i = 0; i < toProcess.length; i++) {
    const song = toProcess[i]
    const progress = `[${i + 1}/${toProcess.length}]`

    console.log(`${progress} Searching: ${song.title} - ${song.artist}`)

    try {
      const searchResult = await searchForVideo(song.title, song.artist)

      if (searchResult) {
        const videoUrl = `https://youtube.com/watch?v=${searchResult.videoId}`
        console.log(`  Found: ${searchResult.title.slice(0, 60)}...`)
        console.log(`  URL: ${videoUrl}`)

        if (!dryRun) {
          db.run('UPDATE songs SET video_url = ? WHERE id = ?', [videoUrl, song.id])
          console.log(`  Saved!`)
        }

        found++
      } else {
        console.log(`  No result found`)
        notFound++
      }
    } catch (error) {
      console.error(`  Error: ${(error as Error).message}`)
      errors++
    }

    // Rate limit: be respectful to APIs
    // Invidious: 1.5 seconds between requests
    // YouTube API: 1 second between requests
    if (i < toProcess.length - 1) {
      const delay = useYouTubeApi ? 1000 : 1500
      await new Promise(r => setTimeout(r, delay))
    }
  }

  // Save database back to file if changes were made
  if (!dryRun && found > 0) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
    console.log('')
    console.log(`Database saved to: ${dbPath}`)
  }

  db.close()

  console.log('')
  console.log('=== Summary ===')
  console.log(`Found: ${found}`)
  console.log(`Not found: ${notFound}`)
  if (errors > 0) {
    console.log(`Errors: ${errors}`)
  }

  if (dryRun) {
    console.log('')
    console.log('This was a dry run. Run without --dry-run to save changes.')
  }

  // Estimate remaining time for remaining songs
  const remaining = songs.length - toProcess.length
  if (remaining > 0 && !dryRun) {
    const delay = useYouTubeApi ? 1 : 1.5
    const minutes = Math.ceil((remaining * delay) / 60)
    console.log('')
    console.log(`${remaining} songs remaining. Run again to continue.`)
    console.log(`Estimated time for all: ~${minutes} minutes`)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
