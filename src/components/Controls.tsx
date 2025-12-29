import { useState, useEffect } from 'react'
import { BackgroundType } from '../backgrounds/BackgroundRenderer'

interface Display {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  label: string
}

interface ScanProgress {
  total: number
  processed: number
  current: string
  added: number
  skipped: number
  errors: number
}

interface SoundfontOption {
  id: string
  name: string
  type: 'local' | 'cdn'
}

export default function Controls() {
  const [catalogPath, setCatalogPath] = useState('/Users/david/Music/Karaoke')
  const [midiOutputs, setMidiOutputs] = useState<Array<{ name: string; id: string }>>([])
  const [selectedMidiOutput, setSelectedMidiOutput] = useState<string>('')
  const [wsHost, setWsHost] = useState<string>(() => localStorage.getItem('midiPiHost') || 'elwynn.local')
  const [wsConnected, setWsConnected] = useState<boolean>(false)
  const [wsConnecting, setWsConnecting] = useState<boolean>(false)
  const [connectionType, setConnectionType] = useState<'websocket' | 'midi' | 'none'>('none')
  const [displays, setDisplays] = useState<Display[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [songCount, setSongCount] = useState<number>(0)
  const [midiDelay, setMidiDelay] = useState<number>(0)
  const [cleaning, setCleaning] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{ removed: number; checked: number } | null>(null)
  const [reloading, setReloading] = useState(false)
  const [showWifiQR, setShowWifiQR] = useState<boolean>(() => {
    return localStorage.getItem('showWifiQR') === 'true'
  })
  const [wifiSSID, setWifiSSID] = useState<string | null>(null)
  const [lyricsMode, setLyricsMode] = useState<'normal' | 'bouncing'>(() => {
    return (localStorage.getItem('lyricsMode') as 'normal' | 'bouncing') || 'normal'
  })
  const [soundfonts, setSoundfonts] = useState<SoundfontOption[]>([])
  const [selectedSoundfont, setSelectedSoundfont] = useState<string>(() => {
    return localStorage.getItem('soundfontId') || 'cdn:FluidR3_GM'
  })
  const [loadingSoundfont, setLoadingSoundfont] = useState(false)
  const [backgroundType, setBackgroundType] = useState<BackgroundType>(() => {
    const saved = localStorage.getItem('backgroundType') as BackgroundType
    // Migrate old 'youtube' setting to new system
    if (saved === 'youtube') {
      localStorage.setItem('backgroundType', 'none')
      localStorage.setItem('youtubeBackgroundEnabled', 'true')
      return 'none'
    }
    return saved || 'none'
  })
  const [backgroundVideoPath, setBackgroundVideoPath] = useState<string | null>(() => {
    return localStorage.getItem('backgroundVideoPath') || null
  })
  const [youtubeEnabled, setYoutubeEnabled] = useState<boolean>(() => {
    return localStorage.getItem('youtubeBackgroundEnabled') !== 'false' // Default to true
  })

  useEffect(() => {
    loadSettings()

    // Listen for scan progress updates
    if (window.electronAPI) {
      // @ts-expect-error - onScanProgress not in types yet
      window.electronAPI.onScanProgress?.((progress: ScanProgress) => {
        setScanProgress(progress)
      })

      // Listen for settings changes from other windows
      const unsubSettings = window.electronAPI.onSettingsChanged((data) => {
        if (data.key === 'soundfontId' && typeof data.value === 'string') {
          setSelectedSoundfont(data.value)
        }
      })

      return () => {
        unsubSettings()
      }
    }
  }, [])

  const loadSettings = async () => {
    if (!window.electronAPI) return

    try {
      const outputs = await window.electronAPI.getMidiOutputs()
      setMidiOutputs(outputs)

      const displayList = await window.electronAPI.getDisplays()
      setDisplays(displayList)

      const delay = await window.electronAPI.getMidiDelay()
      setMidiDelay(delay)

      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)

      // Check if WiFi credentials are configured
      const ssid = await window.electronAPI.getWifiSSID?.()
      setWifiSSID(ssid)

      // Load available soundfonts
      const fonts = await window.electronAPI.listSoundfonts?.() || []
      setSoundfonts(fonts)

      // Re-read the selected soundfont from localStorage to ensure sync
      const savedSoundfont = localStorage.getItem('soundfontId')
      if (savedSoundfont) {
        setSelectedSoundfont(savedSoundfont)
      }

      // Check WebSocket MIDI status
      const universalStatus = await window.electronAPI.getUniversalMidiStatus?.()
      if (universalStatus) {
        setConnectionType(universalStatus.type)
        setWsConnected(universalStatus.type === 'websocket')
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  const handleConnectWebSocket = async () => {
    if (!window.electronAPI) return

    setWsConnecting(true)
    try {
      localStorage.setItem('midiPiHost', wsHost)
      const success = await window.electronAPI.connectWebSocketMidi(wsHost, 8080)
      setWsConnected(success)
      if (success) {
        setConnectionType('websocket')
        setSelectedMidiOutput('') // Clear regular MIDI selection
      }
    } catch (error) {
      console.error('Failed to connect WebSocket MIDI:', error)
      setWsConnected(false)
    } finally {
      setWsConnecting(false)
    }
  }

  const handleDisconnectWebSocket = async () => {
    if (!window.electronAPI) return

    try {
      await window.electronAPI.disconnectWebSocketMidi()
      setWsConnected(false)
      setConnectionType('none')
    } catch (error) {
      console.error('Failed to disconnect WebSocket MIDI:', error)
    }
  }

  const handleSoundfontChange = async (soundfontId: string) => {
    if (!window.electronAPI || loadingSoundfont) return

    setLoadingSoundfont(true)
    setSelectedSoundfont(soundfontId)
    localStorage.setItem('soundfontId', soundfontId)

    try {
      // Broadcast to all windows so they can update their synthesizers
      await window.electronAPI.updateSetting('soundfontId', soundfontId)
    } catch (error) {
      console.error('Failed to update soundfont:', error)
    } finally {
      setLoadingSoundfont(false)
    }
  }

  const handleWifiQRToggle = (enabled: boolean) => {
    setShowWifiQR(enabled)
    localStorage.setItem('showWifiQR', enabled ? 'true' : 'false')
    // Dispatch event so lyrics window can pick it up
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'showWifiQR',
      newValue: enabled ? 'true' : 'false'
    }))
  }

  const handleLyricsModeChange = (mode: 'normal' | 'bouncing') => {
    setLyricsMode(mode)
    localStorage.setItem('lyricsMode', mode)
    // Broadcast to all windows via IPC
    window.electronAPI?.updateSetting('lyricsMode', mode)
  }

  const handleBackgroundTypeChange = async (type: BackgroundType) => {
    setBackgroundType(type)
    localStorage.setItem('backgroundType', type)
    // Broadcast to all windows via IPC
    await window.electronAPI?.updateSetting('backgroundType', type)
  }

  const handleSelectVideo = async () => {
    if (!window.electronAPI) return

    try {
      const path = await window.electronAPI.selectVideoFile?.()
      if (path) {
        setBackgroundVideoPath(path)
        localStorage.setItem('backgroundVideoPath', path)
        await window.electronAPI.updateSetting('backgroundVideoPath', path)
      }
    } catch (error) {
      console.error('Failed to select video file:', error)
    }
  }

  const handleYoutubeToggle = async (enabled: boolean) => {
    setYoutubeEnabled(enabled)
    localStorage.setItem('youtubeBackgroundEnabled', enabled ? 'true' : 'false')
    await window.electronAPI?.updateSetting('youtubeBackgroundEnabled', enabled)
  }

  const handleScanCatalog = async () => {
    console.log('=== SCAN BUTTON CLICKED ===')
    console.log('electronAPI available:', !!window.electronAPI)
    console.log('Catalog path:', catalogPath)

    if (!window.electronAPI) {
      console.error('electronAPI not available!')
      alert('Error: Electron API not available')
      return
    }

    setScanning(true)
    setScanProgress(null)
    try {
      console.log('Calling scanCatalog...')
      const result = await window.electronAPI.scanCatalog(catalogPath)
      console.log('Scan result:', result)
      // Refresh song count
      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)
      setScanProgress(null)
    } catch (error) {
      console.error('Failed to scan catalog:', error)
      alert('Failed to scan catalog. Check the path and try again.')
    } finally {
      setScanning(false)
    }
  }

  const handleMidiOutputChange = async (output: string) => {
    if (!window.electronAPI) return

    setSelectedMidiOutput(output)
    try {
      await window.electronAPI.setMidiOutput(output)
    } catch (error) {
      console.error('Failed to set MIDI output:', error)
    }
  }

  const handleMidiDelayChange = async (delayMs: number) => {
    if (!window.electronAPI) return

    setMidiDelay(delayMs)
    try {
      await window.electronAPI.setMidiDelay(delayMs)
    } catch (error) {
      console.error('Failed to set MIDI delay:', error)
    }
  }

  const handleCleanupCatalog = async () => {
    if (!window.electronAPI) return

    setCleaning(true)
    setCleanupResult(null)
    try {
      const result = await window.electronAPI.cleanupCatalog()
      setCleanupResult(result)
      // Refresh song count
      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)
    } catch (error) {
      console.error('Failed to cleanup catalog:', error)
      alert('Failed to cleanup catalog.')
    } finally {
      setCleaning(false)
    }
  }

  const handleReloadDatabase = async () => {
    if (!window.electronAPI) return

    setReloading(true)
    try {
      await window.electronAPI.reloadDatabase()
      // Refresh song count
      const count = await window.electronAPI.getCatalogCount?.() || 0
      setSongCount(count)
    } catch (error) {
      console.error('Failed to reload database:', error)
      alert('Failed to reload database.')
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="pb-24 max-w-2xl">
      <h2 className="text-xl font-bold text-white mb-6">Settings</h2>

      {/* Catalog Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Song Catalog</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Catalog Folder Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={catalogPath}
                onChange={(e) => setCatalogPath(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                placeholder="/path/to/karaoke/files"
              />
              <button
                onClick={handleScanCatalog}
                disabled={scanning}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {scanning ? 'Scanning...' : 'Scan'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Point this to your folder containing .kar and .mid files
            </p>

            {/* Scan Progress */}
            {scanning && scanProgress && (
              <div className="mt-4 p-4 bg-gray-800 rounded-lg">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Scanning...</span>
                  <span className="text-white">
                    {scanProgress.processed} / {scanProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all"
                    style={{ width: `${(scanProgress.processed / scanProgress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2 truncate">
                  {scanProgress.current}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-green-400">Added: {scanProgress.added}</span>
                  <span className="text-yellow-400">Skipped: {scanProgress.skipped}</span>
                  <span className="text-red-400">Errors: {scanProgress.errors}</span>
                </div>
              </div>
            )}

            {/* Song Count */}
            {songCount > 0 && !scanning && (
              <div className="mt-4 p-3 bg-green-900/30 border border-green-800 rounded-lg flex items-center justify-between">
                <span className="text-green-400">{songCount} songs in catalog</span>
                <div className="flex gap-2">
                  <button
                    onClick={handleReloadDatabase}
                    disabled={reloading}
                    className="px-3 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded text-sm transition-colors"
                    title="Reload database to pick up external changes"
                  >
                    {reloading ? 'Reloading...' : 'Reload DB'}
                  </button>
                  <button
                    onClick={handleCleanupCatalog}
                    disabled={cleaning}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded text-sm transition-colors"
                  >
                    {cleaning ? 'Cleaning...' : 'Remove Missing'}
                  </button>
                </div>
              </div>
            )}

            {/* Cleanup Result */}
            {cleanupResult && (
              <div className="mt-2 p-3 bg-blue-900/30 border border-blue-800 rounded-lg">
                <span className="text-blue-400">
                  Checked {cleanupResult.checked} songs, removed {cleanupResult.removed} missing files
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* MIDI Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">MIDI Output</h3>

        <div className="space-y-4">
          {/* Connection Status */}
          <div className={`p-3 rounded-lg ${
            connectionType === 'websocket' ? 'bg-green-900/30 border border-green-800' :
            connectionType === 'midi' ? 'bg-blue-900/30 border border-blue-800' :
            'bg-gray-800 border border-gray-700'
          }`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                connectionType !== 'none' ? 'bg-green-400' : 'bg-gray-500'
              }`} />
              <span className={connectionType !== 'none' ? 'text-white' : 'text-gray-400'}>
                {connectionType === 'websocket' ? `Connected via WebSocket (${wsHost})` :
                 connectionType === 'midi' ? `Connected via MIDI (${selectedMidiOutput})` :
                 'Not connected'}
              </span>
            </div>
          </div>

          {/* MIDI Piano Pi Server (WebSocket) - Recommended */}
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-medium">MIDI Piano Pi Server (Recommended)</p>
                <p className="text-xs text-gray-400">Direct connection via WebSocket</p>
              </div>
              {wsConnected && (
                <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">
                  Active
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={wsHost}
                onChange={(e) => setWsHost(e.target.value)}
                placeholder="elwynn.local or IP address"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-indigo-500"
              />
              {wsConnected ? (
                <button
                  onClick={handleDisconnectWebSocket}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleConnectWebSocket}
                  disabled={wsConnecting || !wsHost}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm transition-colors"
                >
                  {wsConnecting ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          </div>

          {/* Alternative: Direct MIDI */}
          <div className={`p-4 rounded-lg border ${wsConnected ? 'bg-gray-900 border-gray-800 opacity-60' : 'bg-gray-800 border-gray-700'}`}>
            <p className="text-sm text-gray-400 mb-2">Alternative: Direct MIDI Output</p>
            <select
              value={selectedMidiOutput}
              onChange={(e) => handleMidiOutputChange(e.target.value)}
              disabled={wsConnected}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Select MIDI Output...</option>
              {midiOutputs.map((output: { name: string; id: string }) => (
                <option key={output.id || output.name} value={output.name}>
                  {output.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">
              Use Network MIDI in Audio MIDI Setup (may have latency issues)
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Audio Delay (for synchronization)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="500"
                step="10"
                value={midiDelay}
                onChange={(e) => handleMidiDelayChange(parseInt(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-white w-16 text-right">{midiDelay}ms</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Delay computer audio to sync with the MIDI piano. Increase if the backing track plays before the piano.
            </p>
          </div>

          <button
            onClick={loadSettings}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
          >
            Refresh MIDI Devices
          </button>
        </div>
      </section>

      {/* Audio Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Audio</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Soundfont (Instrument Sounds)
            </label>
            <select
              value={selectedSoundfont}
              onChange={(e) => handleSoundfontChange(e.target.value)}
              disabled={loadingSoundfont}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              {soundfonts.map((sf) => (
                <option key={sf.id} value={sf.id}>
                  {sf.name} {sf.type === 'cdn' ? '(streaming)' : '(local file)'}
                </option>
              ))}
            </select>
            {loadingSoundfont && (
              <p className="text-xs text-yellow-400 mt-2">
                Loading soundfont... This may take a moment for large files.
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Affects the sound quality of non-piano instruments. Local SF2 files provide
              better quality but require more memory. Place SF2 files in the soundfonts folder.
            </p>
          </div>
        </div>
      </section>

      {/* Display Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Display</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Available Displays
            </label>
            <div className="grid gap-2">
              {displays.map((display) => (
                <div
                  key={display.id}
                  className="p-3 bg-gray-800 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <span className="text-white">{display.label}</span>
                    <span className="text-gray-500 text-sm ml-2">
                      ({display.bounds.width} x {display.bounds.height})
                    </span>
                  </div>
                  {display.bounds.x === 0 && display.bounds.y === 0 && (
                    <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded">
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              The lyrics display will open on an external display if available
            </p>
          </div>
        </div>
      </section>

      {/* Lyrics Display Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Lyrics Display</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Highlighting Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleLyricsModeChange('normal')}
                className={`p-4 rounded-lg border-2 transition-colors text-left ${
                  lyricsMode === 'normal'
                    ? 'border-indigo-500 bg-indigo-900/30'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <span className="block text-white font-medium">Normal</span>
                <span className="text-xs text-gray-400">
                  Words highlight as they're sung
                </span>
              </button>
              <button
                onClick={() => handleLyricsModeChange('bouncing')}
                className={`p-4 rounded-lg border-2 transition-colors text-left ${
                  lyricsMode === 'bouncing'
                    ? 'border-indigo-500 bg-indigo-900/30'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <span className="block text-white font-medium">Bouncing Ball</span>
                <span className="text-xs text-gray-400">
                  Classic karaoke ball follows words
                </span>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Controls how syllables are highlighted during playback
            </p>
          </div>
        </div>
      </section>

      {/* Background Settings */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Background</h3>

        <div className="space-y-4">
          {/* YouTube Toggle */}
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">YouTube Music Videos</p>
                <p className="text-xs text-gray-400 mt-1">
                  Show song's YouTube video as background when available
                </p>
              </div>
              <button
                onClick={() => handleYoutubeToggle(!youtubeEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  youtubeEnabled ? 'bg-red-600' : 'bg-gray-600'
                } cursor-pointer`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    youtubeEnabled ? 'translate-x-6' : ''
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Set YouTube URLs per-song using the video icon in the Catalog tab.
            </p>
          </div>

          {/* Fallback Background Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              {youtubeEnabled ? 'Fallback Background' : 'Background Type'}
            </label>
            <p className="text-xs text-gray-500 mb-3">
              {youtubeEnabled
                ? 'Shown when the current song has no YouTube video'
                : 'Background animation for the lyrics display'}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'none', label: 'Solid Color', desc: 'Default dark background' },
                { id: 'starfield', label: 'Starfield', desc: 'Flying through stars' },
                { id: 'matrix', label: 'Matrix', desc: 'Green falling code' },
                { id: 'gradient', label: 'Gradient', desc: 'Shifting colors' },
                { id: 'visualizer', label: 'Visualizer', desc: 'Audio-reactive ring' },
                { id: 'video', label: 'Video File', desc: 'Local video loop' }
              ].map(bg => (
                <button
                  key={bg.id}
                  onClick={() => handleBackgroundTypeChange(bg.id as BackgroundType)}
                  className={`p-3 rounded-lg border-2 transition-colors text-left ${
                    backgroundType === bg.id
                      ? 'border-indigo-500 bg-indigo-900/30'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                  }`}
                >
                  <span className="block text-white font-medium text-sm">{bg.label}</span>
                  <span className="text-xs text-gray-400">{bg.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Video file selector */}
          {backgroundType === 'video' && (
            <div className="p-4 bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-400 mb-2">
                {backgroundVideoPath
                  ? `Selected: ${backgroundVideoPath.split('/').pop()}`
                  : 'No video selected'}
              </p>
              <button
                onClick={handleSelectVideo}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition-colors"
              >
                Select Video File
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Supports MP4, WebM, MOV, and other video formats
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Web Interface */}
      <section className="mb-8">
        <h3 className="text-lg font-medium text-gray-300 mb-4">Guest Web Interface</h3>

        <div className="p-4 bg-gray-800 rounded-lg space-y-4">
          <div>
            <p className="text-gray-400 mb-2">
              Guests can scan the QR code on the lyrics display to queue songs.
            </p>
            <p className="text-xs text-gray-500">
              The QR code will be displayed on the lyrics screen automatically.
            </p>
          </div>

          {/* WiFi QR Code Toggle */}
          <div className="border-t border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white">Show WiFi QR Code</p>
                <p className="text-xs text-gray-500">
                  {wifiSSID
                    ? `Display QR code for "${wifiSSID}" network`
                    : 'Configure WIFI_SSID in .env file to enable'}
                </p>
              </div>
              <button
                onClick={() => handleWifiQRToggle(!showWifiQR)}
                disabled={!wifiSSID}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  showWifiQR && wifiSSID
                    ? 'bg-indigo-600'
                    : 'bg-gray-600'
                } ${!wifiSSID ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    showWifiQR && wifiSSID ? 'translate-x-6' : ''
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
