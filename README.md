# Disklavier Karaoke

A karaoke system for Yamaha Disklavier pianos. The Disklavier plays the piano parts while your computer handles the backing tracks and lyrics display.

## Requirements

- macOS, Windows, or Linux
- Yamaha Disklavier (connected via Network MIDI)
- A collection of .kar or .mid files with embedded lyrics
- External display for lyrics (optional but recommended)

## Installation

Download the latest release for your platform from the [Releases](https://github.com/DavidWatkins/disklavier-karaoke/releases) page.

Or build from source:

```bash
git clone https://github.com/DavidWatkins/disklavier-karaoke.git
cd disklavier-karaoke
npm install
npm run dev
```

## Setup

### 1. Scan Your Song Library

1. Go to the **Settings** tab
2. Enter the path to your folder containing .kar/.mid files
3. Click **Scan**

The scanner will index all songs and detect their language (English/Spanish).

### 2. Connect Your Disklavier

1. In **Settings**, find the MIDI Output Device dropdown
2. Select your Disklavier (it will auto-connect if detected)
3. Adjust the **Audio Delay** slider if the backing tracks are out of sync with the piano

### 3. Open the Lyrics Display

Click **Open Lyrics Window** in the main interface. If you have an external display connected, the lyrics will open there in fullscreen.

## Usage

### Queuing Songs

1. Go to the **Catalog** tab
2. Search for songs or browse by language
3. Click **Add to Queue** on any song
4. Enter the singer's name

Songs play automatically in queue order.

### Playback Controls

- **Play/Pause**: Space bar or the play button
- **Skip**: Skips to the next song in queue
- **Seek**: Click anywhere on the progress bar

### Guest Web Interface

Guests can queue songs from their phones:

1. A QR code appears on the lyrics display
2. Guests scan it to open the web interface
3. They can search and add songs to the queue

To show a WiFi QR code alongside, create a `.env` file:

```
WIFI_SSID=YourNetworkName
WIFI_PASSWORD=YourPassword
```

## Settings

### Soundfonts

The app synthesizes non-piano instruments. You can choose between:

- **FluidR3 GM** or **MusyngKite** (streamed from CDN)
- **Local SF2 files** (better quality, place .sf2 files in a `soundfonts` folder)

### Lyrics Display Mode

- **Normal**: Words highlight as they're sung
- **Bouncing Ball**: Classic karaoke ball follows along

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| Escape | Exit fullscreen lyrics |

## Troubleshooting

**No sound from backing tracks**: Click "Enable Audio" in the top bar. Browsers require user interaction before playing audio.

**Piano out of sync**: Adjust the Audio Delay in Settings. Increase if backing tracks play before the piano.

**Songs not appearing**: Make sure your files have .kar or .mid extensions and contain valid MIDI data.

## License

MIT
