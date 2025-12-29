#!/usr/bin/env node

/**
 * Test MIDI output using node-midi (RtMidi) instead of JZZ
 * to see if it handles Network MIDI correctly.
 */

import midi from 'midi'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const output = new midi.Output()

  console.log('Available MIDI outputs:')
  const portCount = output.getPortCount()

  let networkMidiPort = -1
  for (let i = 0; i < portCount; i++) {
    const name = output.getPortName(i)
    console.log(`  ${i}: ${name}`)
    if (/network|session|disklavier/i.test(name)) {
      networkMidiPort = i
    }
  }

  if (networkMidiPort === -1) {
    console.log('\nNo Network MIDI port found. Available ports listed above.')
    console.log('Try creating a Network MIDI session in Audio MIDI Setup first.')
    process.exit(1)
  }

  console.log(`\nOpening port ${networkMidiPort}: ${output.getPortName(networkMidiPort)}`)
  output.openPort(networkMidiPort)

  console.log('Playing C major scale on channel 0...\n')

  // C major scale
  const notes = [60, 62, 64, 65, 67, 69, 71, 72] // C4 to C5

  for (const note of notes) {
    console.log(`  Note ON: ${note} (expected key: ${noteToName(note)})`)
    output.sendMessage([0x90, note, 80]) // Note on, channel 0, velocity 80
    await sleep(400)
    output.sendMessage([0x80, note, 0]) // Note off
    await sleep(100)
  }

  console.log('\nDone! Did the correct keys play this time?')
  console.log('Expected: C4, D4, E4, F4, G4, A4, B4, C5')

  // All notes off
  for (let ch = 0; ch < 16; ch++) {
    output.sendMessage([0xB0 | ch, 123, 0])
  }

  output.closePort()
  process.exit(0)
}

function noteToName(note) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(note / 12) - 1
  return names[note % 12] + octave
}

main().catch(console.error)
