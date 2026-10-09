# WaveAMP for VS Code

A music player in the VS Code sidebar. This is the VS Code edition of [WaveAMP](https://github.com/darkdkl/waveamp), a free desktop music player for Windows, macOS and Linux, with the same look, playlist, equalizer and internet radio.

![WaveAMP playing a CUE album in the VS Code sidebar](images/hero.png)

## Features

- **Local files and CUE albums** — add files or whole folders. An album ripped as one file plays as separate tracks from its `.cue` sheet, with seeking inside each track and no gap between them.
- **Tags and cover art** — artist and title from the file tags, and the album cover or the station logo behind the display.
- **10-band equalizer** with a preamp and 18 presets.
- **Stereo widening** for tracks and radio, with a gentle pseudo-stereo effect for mono sources.
- **Internet radio** — search thousands of stations by name, country, region and genre, keep favorites, add your own stations by URL, and see the title of the track that is playing.
- **Saved track titles** — bookmark a song you hear on the radio and copy its title later.
- **Fits your theme** — a light or dark body that follows VS Code, six accent colors, and a status bar button with the current track.

| Equalizer | Radio | Light theme |
| --- | --- | --- |
| ![Equalizer with the Rock preset](images/eq.png) | ![Favorite radio stations with the current track title](images/radio.png) | ![WaveAMP with a light VS Code theme](images/light.png) |

You can drag the WaveAMP icon to the secondary side bar to keep the player next to your code:

![WaveAMP in the secondary side bar next to the editor](images/sidebar-right.png)

## Supported formats

- **Files:** MP3, FLAC, WAV, OGG, OPUS, M4A, M4B and AAC, and CUE sheets for any of them.
- **Radio streams:** MP3, AAC and OGG, including `.pls` and `.m3u` playlist links.

## Getting started

1. Open **WaveAMP** from the activity bar.
2. Add music with the file and folder buttons in the playlist, or open **Radio** and search for a station.
3. Press **▶** in the player. VS Code only lets a panel play sound after you click inside it once per session — after that, the status bar button and the commands work too.

## Settings

Open them from the **…** menu of the WaveAMP panel → **Open Settings**.

| Setting | Default | Description |
| --- | --- | --- |
| `waveamp.accentColor` | `classic` | Color of the display and the highlighted controls: Classic, Amber, Ice, Violet, Ruby or Mono. |
| `waveamp.body` | `auto` | Player body: follow the VS Code theme, always dark or always light. |
| `waveamp.coverArt` | `true` | Show the album cover or the station logo behind the display. |
| `waveamp.radio.showTrackTitles` | `true` | Show the title of the track playing on a radio station. |
| `waveamp.stereo.tracks` | `false` | Make local tracks sound wider in stereo. |
| `waveamp.stereo.radio` | `false` | Make radio stations sound wider in stereo. |
| `waveamp.stereo.strength` | `50` | How much wider, from `0` to `100`. |
| `waveamp.stereo.pseudoStereo` | `true` | Give mono tracks and stations a gentle stereo effect when widening is on. |

## Commands

All commands are in the Command Palette, and you can bind keys to them in **Keyboard Shortcuts**:

`WaveAMP: Play / Pause`, `Stop`, `Next Track`, `Previous Track`, `Add Files`, `Add Folder`, `Add Station`, `Save Track Title`, `Open Settings`.

## Privacy

WaveAMP has no telemetry and no account. The player runs a small media server inside the extension that listens only on `127.0.0.1`, uses a random port and a random key for every session, and only reads files you add. Station search uses the public [radio-browser.info](https://www.radio-browser.info) catalog; when you play a station from it, WaveAMP tells the catalog which station it was, as radio players usually do. Your own stations are never sent anywhere except to the station itself. Your favorites and saved track titles sync between your machines only through VS Code Settings Sync, if you have it turned on.

## Limitations

- AAC is decoded with FAAD2 built for AAC-LC only. HE-AAC ("AAC+" at low bitrates) plays its core layer, so it sounds duller than intended. High-bitrate "AAC+" stations are usually plain AAC-LC and play in full.
- Protected iTunes files (`.m4p`) and xHE-AAC are not supported.

## License

WaveAMP is free software under the GNU General Public License, version 3 or later — see [LICENSE](LICENSE). Third-party notices are in `THIRD_PARTY_LICENSES.txt` inside the extension. Code from FAAD2 is copyright (c) Nero AG, www.nero.com.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
