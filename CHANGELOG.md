# Changelog

## 0.11.1

- Drop the knobs from the activity bar icon so it matches the cleaner extension icon.

## 0.11.0

- Find the radio catalog mirrors automatically instead of using a fixed list, cache them for a day and try the mirror that answered last first.
- Keep where to look for mirrors in `radio-sources.json`, with the commands **Open Radio Sources File** and **Refresh Radio Mirrors**.
- Look up mirrors only through HTTP unless the proxy mode is Direct, so nothing goes around the proxy.
- Say that the station catalog is unavailable when no mirror answers.
- Use the cleaner extension icon: bars without knobs, crisper glow.

## 0.10.2

- Send the extension version in the User-Agent of radio requests.

## 0.10.1

- Lock the equalizer bands, preset list and Reset while the equalizer is off.

## 0.10.0

- Turn the equalizer on and off with a sliding switch, and make Reset a button.
- Make disabled controls look the same everywhere.

## 0.9.2

- Make dim text on the display easier to read in every accent color: its brightness adapts to the hue to keep the same contrast.

## 0.9.1

- Make the bookmark for saving a radio track easier to hit, with a highlight on hover.
- Drop the small tip after the bars in the extension icon.

## 0.9.0

- Scroll long titles on the display: back and forth (the default), in a loop or once, at a speed you choose.

## 0.8.0

- New icon, in the style of the new WaveAMP app icon, for the extension and the activity bar.

## 0.7.8

- Keep VS Code responsive while an AAC station sends its first burst of audio.

## 0.7.7

- Rebuild the player panel in TypeScript. Nothing changes on screen.
- Show the STEREO / MONO indicator also for tracks with very little stereo.

## 0.7.6

- Start WaveAMP when its panel or a command is opened, not with every VS Code window.
- Serve only the files in the playlist from the local media server.
- Reconnect an AAC station that switches to another sample rate instead of playing it at the wrong speed.
- Check and limit synced favorite stations.
- Use less memory for long audiobooks.

## 0.7.5

- Report a station playlist that is too large as an error instead of reading it as empty.

## 0.7.4

- Fill large playlists quickly without freezing the panel, and keep track tags between sessions.
- Open local files from the add dialogs in Remote SSH, WSL and container windows.
- Say that HLS streams are not supported instead of failing silently.
- Count a station play in the catalog only once, not on every reconnect.

## 0.7.3

- Fix AAC radio going silent or failing after a station drops the connection.
- Add M4B audiobooks from the file dialog and folders.
- Connect to stations on this computer directly when a custom proxy is set.
- Give up on a station that does not answer in 15 seconds, so reconnecting starts sooner.
- Skip station logos larger than 2 MB instead of waiting for them.

## 0.7.2

- Reuse connections to the station catalog, so search is faster and steadier through a proxy.

## 0.7.1

- Retry the station catalog and playlist requests when a proxy drops the connection.
- Remove station catalog mirrors that no longer exist.

## 0.7.0

- Media keys and system media controls: play, pause, next, previous and stop, with the track title and cover.

## 0.6.0

- Proxy settings: use the VS Code proxy, connect directly, or set an HTTP or SOCKS5 proxy for WaveAMP only.

## 0.5.0

- Play AAC files (`.m4a`, `.m4b`, `.mp4`, `.aac`) and AAC radio streams.
- List the supported formats in the extension description.

## 0.4.0

- Show the album cover or the station logo behind the display.
- Use icon buttons for search, adding a station, favorites and saved titles in the radio panel.

## 0.3.0

- Stereo widening for tracks and radio, with pseudo-stereo for mono sources.
- Remove the action icons from the panel title.

## 0.2.0

- Settings for the accent color, the player body and radio track titles.
- **Open Settings** in the panel menu.
- Sync favorite stations and saved track titles with Settings Sync.

## 0.1.0

- First release: playlist with tags and CUE albums, 10-band equalizer, internet radio with favorites, custom stations and saved track titles, light and dark body.
