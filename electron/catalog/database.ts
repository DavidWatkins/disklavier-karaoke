import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'

export type FileType = 'midi' | 'cdg'

export interface Song {
  id: number
  file_path: string
  title: string
  artist: string
  duration_ms: number
  has_lyrics: boolean
  track_count: number
  file_hash: string
  language: string // 'en', 'es', or 'other'
  video_url: string | null // YouTube or other video URL for background
  file_type: FileType // 'midi' for KAR/MID files, 'cdg' for CDG+MP3 files
  audio_path: string | null // For CDG files: path to associated MP3
  created_at: string
  last_played_at: string | null
}

export interface QueueItem {
  id: number
  song_id: number
  singer_name: string
  queued_at: string
  status: 'pending' | 'playing' | 'completed' | 'skipped'
  session_id: string
  // Joined fields
  title?: string
  artist?: string
}

class CatalogDatabase {
  private db: Database.Database | null = null

  initialize(): void {
    if (this.db) return

    // Store database in user data directory
    const userDataPath = app.getPath('userData')
    const dbPath = path.join(userDataPath, 'catalog.db')

    console.log(`Opening database at: ${dbPath}`)

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')

    this.createTables()
  }

  reload(): void {
    // Close existing connection and reopen to pick up external changes
    const userDataPath = app.getPath('userData')
    const dbPath = path.join(userDataPath, 'catalog.db')

    console.log('Reloading database...')

    if (this.db) {
      this.db.close()
      this.db = null
    }

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')

    console.log('Database reloaded successfully')
  }

  private createTables(): void {
    if (!this.db) return

    // Songs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        artist TEXT DEFAULT '',
        duration_ms INTEGER DEFAULT 0,
        has_lyrics BOOLEAN DEFAULT 0,
        track_count INTEGER DEFAULT 0,
        file_hash TEXT,
        language TEXT DEFAULT 'en',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_played_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
      CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
      CREATE INDEX IF NOT EXISTS idx_songs_file_path ON songs(file_path);
    `)

    // Migration: add language column if it doesn't exist (for existing databases)
    try {
      this.db.exec(`ALTER TABLE songs ADD COLUMN language TEXT DEFAULT 'en'`)
      console.log('Added language column to songs table')
    } catch {
      // Column already exists, which is fine
    }

    // Create language index after migration ensures column exists
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_songs_language ON songs(language)`)

    // Migration: add video_url column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE songs ADD COLUMN video_url TEXT`)
      console.log('Added video_url column to songs table')
    } catch {
      // Column already exists, which is fine
    }

    // Migration: add file_type column for CDG support
    try {
      this.db.exec(`ALTER TABLE songs ADD COLUMN file_type TEXT DEFAULT 'midi'`)
      console.log('Added file_type column to songs table')
    } catch {
      // Column already exists, which is fine
    }

    // Migration: add audio_path column for CDG+MP3 files
    try {
      this.db.exec(`ALTER TABLE songs ADD COLUMN audio_path TEXT`)
      console.log('Added audio_path column to songs table')
    } catch {
      // Column already exists, which is fine
    }

    // Queue table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
        singer_name TEXT NOT NULL,
        queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending',
        session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
      CREATE INDEX IF NOT EXISTS idx_queue_queued_at ON queue(queued_at);
    `)

    // Play history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
        singer_name TEXT,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_history_played_at ON play_history(played_at);
    `)

    console.log('Database tables created/verified')
  }

  // Song operations
  addSong(song: Omit<Song, 'id' | 'created_at' | 'last_played_at'>): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO songs (file_path, title, artist, duration_ms, has_lyrics, track_count, file_hash, language, file_type, audio_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      song.file_path,
      song.title,
      song.artist,
      song.duration_ms,
      song.has_lyrics ? 1 : 0,
      song.track_count,
      song.file_hash,
      song.language || 'en',
      song.file_type || 'midi',
      song.audio_path || null
    )

    return result.lastInsertRowid as number
  }

  getSong(id: number): Song | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM songs WHERE id = ?')
    return stmt.get(id) as Song | null
  }

  getSongByPath(filePath: string): Song | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM songs WHERE file_path = ?')
    return stmt.get(filePath) as Song | null
  }

  searchSongs(query: string, limit = 100, filters?: { hasLyrics?: boolean; hasVideo?: boolean }): Song[] {
    if (!this.db) return [] // Not yet initialized

    // Build WHERE clauses based on filters
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.trim()) {
      const searchPattern = `%${query}%`
      conditions.push('(title LIKE ? OR artist LIKE ?)')
      params.push(searchPattern, searchPattern)
    }

    if (filters?.hasLyrics) {
      conditions.push('has_lyrics = 1')
    }

    if (filters?.hasVideo) {
      conditions.push("video_url IS NOT NULL AND video_url != ''")
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    if (!query.trim()) {
      // Return all songs matching filters
      const stmt = this.db.prepare(`SELECT * FROM songs ${whereClause} ORDER BY title LIMIT ?`)
      params.push(limit)
      return stmt.all(...params) as Song[]
    }

    // With search query, use relevance ordering
    const exactPattern = `${query}%`
    const stmt = this.db.prepare(`
      SELECT * FROM songs
      ${whereClause}
      ORDER BY
        CASE
          WHEN title LIKE ? THEN 1
          WHEN artist LIKE ? THEN 2
          ELSE 3
        END,
        title
      LIMIT ?
    `)

    params.push(exactPattern, exactPattern, limit)
    return stmt.all(...params) as Song[]
  }

  getAllSongs(): Song[] {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT * FROM songs ORDER BY title')
    return stmt.all() as Song[]
  }

  getSongCount(): number {
    if (!this.db) return 0 // Not yet initialized

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM songs')
    const result = stmt.get() as { count: number }
    return result.count
  }

  updateLastPlayed(songId: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('UPDATE songs SET last_played_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(songId)
  }

  // Video URL operations
  updateSongVideoUrl(songId: number, videoUrl: string | null): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('UPDATE songs SET video_url = ? WHERE id = ?')
    stmt.run(videoUrl, songId)
  }

  getSongVideoUrl(songId: number): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('SELECT video_url FROM songs WHERE id = ?')
    const result = stmt.get(songId) as { video_url: string | null } | undefined
    return result?.video_url || null
  }

  // Queue operations
  addToQueue(songId: number, singerName: string, sessionId?: string): number {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO queue (song_id, singer_name, session_id)
      VALUES (?, ?, ?)
    `)

    const result = stmt.run(songId, singerName, sessionId || '')
    return result.lastInsertRowid as number
  }

  removeFromQueue(queueId: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('DELETE FROM queue WHERE id = ?')
    stmt.run(queueId)
  }

  getQueue(): QueueItem[] {
    if (!this.db) return [] // Not yet initialized

    const stmt = this.db.prepare(`
      SELECT q.*, s.title, s.artist
      FROM queue q
      JOIN songs s ON q.song_id = s.id
      WHERE q.status IN ('pending', 'playing')
      ORDER BY
        CASE q.status WHEN 'playing' THEN 0 ELSE 1 END,
        q.queued_at
    `)

    return stmt.all() as QueueItem[]
  }

  getNextInQueue(): QueueItem | null {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT q.*, s.title, s.artist
      FROM queue q
      JOIN songs s ON q.song_id = s.id
      WHERE q.status = 'pending'
      ORDER BY q.queued_at
      LIMIT 1
    `)

    return stmt.get() as QueueItem | null
  }

  setQueueItemStatus(queueId: number, status: QueueItem['status']): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('UPDATE queue SET status = ? WHERE id = ?')
    stmt.run(status, queueId)
  }

  clearQueue(): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare("DELETE FROM queue WHERE status = 'pending'")
    stmt.run()
  }

  // Reset any stale 'playing' items to 'skipped' (called on app startup)
  resetStaleQueue(): void {
    if (!this.db) return

    const stmt = this.db.prepare("UPDATE queue SET status = 'skipped' WHERE status = 'playing'")
    const result = stmt.run()
    if (result.changes > 0) {
      console.log(`Reset ${result.changes} stale playing items to skipped`)
    }
  }

  // Play history
  addToHistory(songId: number, singerName: string): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO play_history (song_id, singer_name)
      VALUES (?, ?)
    `)
    stmt.run(songId, singerName)
  }

  getRecentHistory(limit = 50): Array<{ song_id: number; singer_name: string; played_at: string; title: string }> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      SELECT h.*, s.title
      FROM play_history h
      JOIN songs s ON h.song_id = s.id
      ORDER BY h.played_at DESC
      LIMIT ?
    `)

    return stmt.all(limit) as Array<{ song_id: number; singer_name: string; played_at: string; title: string }>
  }

  getPopularSongs(limit = 20): Song[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT s.*, COUNT(h.id) as play_count
      FROM songs s
      LEFT JOIN play_history h ON s.id = h.song_id
      GROUP BY s.id
      ORDER BY play_count DESC, s.title
      LIMIT ?
    `)

    return stmt.all(limit) as Song[]
  }

  getRandomSongs(limit = 20): Song[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT * FROM songs
      ORDER BY RANDOM()
      LIMIT ?
    `)

    return stmt.all(limit) as Song[]
  }

  getSongsByLanguage(language: string, limit = 50): Song[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT * FROM songs
      WHERE language = ?
      ORDER BY title
      LIMIT ?
    `)

    return stmt.all(language, limit) as Song[]
  }

  getPopularByLanguage(language: string, limit = 20): Song[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT s.*, COUNT(h.id) as play_count
      FROM songs s
      LEFT JOIN play_history h ON s.id = h.song_id
      WHERE s.language = ?
      GROUP BY s.id
      ORDER BY play_count DESC, s.title
      LIMIT ?
    `)

    return stmt.all(language, limit) as Song[]
  }

  getRandomByLanguage(language: string, limit = 20): Song[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT * FROM songs
      WHERE language = ?
      ORDER BY RANDOM()
      LIMIT ?
    `)

    return stmt.all(language, limit) as Song[]
  }

  searchSongsByLanguage(query: string, language: string, limit = 100): Song[] {
    if (!this.db) return []

    if (!query.trim()) {
      return this.getSongsByLanguage(language, limit)
    }

    const searchPattern = `%${query}%`
    const exactPattern = `${query}%`
    const stmt = this.db.prepare(`
      SELECT * FROM songs
      WHERE language = ? AND (title LIKE ? OR artist LIKE ?)
      ORDER BY
        CASE
          WHEN title LIKE ? THEN 1
          WHEN artist LIKE ? THEN 2
          ELSE 3
        END,
        title
      LIMIT ?
    `)

    return stmt.all(language, searchPattern, searchPattern, exactPattern, exactPattern, limit) as Song[]
  }

  getLanguageCounts(): { language: string; count: number }[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT language, COUNT(*) as count
      FROM songs
      GROUP BY language
      ORDER BY count DESC
    `)

    return stmt.all() as { language: string; count: number }[]
  }

  // Cleanup - remove songs whose files no longer exist
  cleanupMissingSongs(): { removed: number; checked: number } {
    if (!this.db) throw new Error('Database not initialized')

    const allSongs = this.getAllSongs()
    let removed = 0

    const deleteStmt = this.db.prepare('DELETE FROM songs WHERE id = ?')

    for (const song of allSongs) {
      if (!fs.existsSync(song.file_path)) {
        console.log(`Removing missing file from catalog: ${song.file_path}`)
        deleteStmt.run(song.id)
        removed++
      }
    }

    console.log(`Catalog cleanup: checked ${allSongs.length} songs, removed ${removed} missing`)
    return { removed, checked: allSongs.length }
  }

  // Delete a specific song by ID
  deleteSong(id: number): void {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('DELETE FROM songs WHERE id = ?')
    stmt.run(id)
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// Singleton instance
export const catalogDb = new CatalogDatabase()
