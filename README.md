# MIDI Karaoke

A karaoke application for MIDI-enabled pianos. The piano plays the piano parts while your computer handles backing tracks and lyrics display. Tested with Yamaha DKC-800.

## Requirements

- macOS (Apple Silicon or Intel)
- MIDI-enabled piano with network or USB connectivity
- [MIDI Piano Pi Server](https://github.com/DavidWatkins/midi-piano-pi-server) installed on a Raspberry Pi (recommended)
- Collection of .kar or .mid files with embedded lyrics
- External display for lyrics (optional)

## Installation

Download the latest release from [Releases](https://github.com/DavidWatkins/midi-karaoke/releases).

Or build from source:

```bash
git clone https://github.com/DavidWatkins/midi-karaoke.git
cd midi-karaoke
npm install
npm run build
```

## Connecting to Your Piano

### Option 1: Via MIDI Piano Pi Server (Recommended)

This method provides the most reliable connection with no latency issues.

1. Install [MIDI Piano Pi Server](https://github.com/DavidWatkins/midi-piano-pi-server) on a Raspberry Pi connected to your piano via USB
2. In this app, go to **Settings** > **MIDI Output**
3. Under "MIDI Piano Pi Server", enter your Pi's hostname (e.g., `raspberrypi.local` or IP address)
4. Click **Connect**

The status indicator will turn green when connected.

### Option 2: Direct Network MIDI

Less reliable due to Apple MIDI Network protocol overhead.

1. Open **Audio MIDI Setup** on your Mac
2. Open MIDI Studio (Cmd+2)
3. Connect to your piano via the Network panel
4. In this app, go to **Settings** and select the MIDI device from the dropdown

## Setup

### 1. Scan Your Song Library

1. Go to **Settings**
2. Enter the path to your folder containing .kar/.mid files
3. Click **Scan**

### 2. Open Lyrics Display

Click **Open Lyrics Window**. If an external display is connected, lyrics open there in fullscreen.

## Usage

### Queuing Songs

1. Go to **Catalog**
2. Search or browse for songs
3. Click a song to add to queue
4. Enter the singer's name

Songs play automatically in queue order.

### Guest Interface

Guests can queue songs from their phones:

1. A QR code appears on the lyrics display
2. Guests scan it to open the web interface
3. They can search and add songs

To show a WiFi QR code, create a `.env` file:

```
WIFI_SSID=YourNetworkName
WIFI_PASSWORD=YourPassword
```

### Audio Sync

If backing tracks are out of sync with the piano, adjust **Audio Delay** in Settings. Increase if backing tracks play before the piano.

## Settings

### Soundfonts

Non-piano instruments are synthesized. Options:

- **FluidR3 GM** or **MusyngKite** (streamed)
- **Local SF2 files** (better quality, place in `soundfonts` folder)

### Lyrics Mode

- **Normal**: Words highlight as sung
- **Bouncing Ball**: Classic karaoke ball

### Background

- **YouTube Videos**: Set per-song using the video icon in Catalog
- **Animated**: Starfield, Matrix, Gradient, or Audio Visualizer
- **Video File**: Loop a local video

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| Escape | Exit fullscreen |

## Troubleshooting

**No sound from backing tracks:** Click "Enable Audio" in the top bar.

**Piano not playing:** Check connection status in Settings. Try MIDI Piano Pi Server if using Network MIDI.

**Songs not appearing:** Ensure files have .kar or .mid extensions.

## License

MIT
