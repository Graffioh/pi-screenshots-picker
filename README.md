# pi-screenshots-picker

A [pi coding agent](https://github.com/badlogic/pi-mono/) extension for quickly selecting and attaching screenshots to your prompts. Works on **macOS** and **Linux**. Browse recent screenshots with thumbnail previews, stage multiple images, then type your message - screenshots attach automatically when you send.

## Why

Attaching screenshots during development is tedious. You're constantly:
- Dragging files from Desktop/Finder
- Losing track of which screenshot is which
- Breaking your flow to find the right image

pi-screenshots-picker gives you a visual screenshot browser right in your terminal:

```
/ss
```

## Install

```bash
pi install npm:pi-screenshots-picker
```

## Quick Start

1. Press `Ctrl+Shift+S` or type `/ss` to open the picker
2. Navigate with `↑↓`, press `s` or `space` to stage screenshots (✓ appears)
3. Press `Enter` to close the picker
4. Type your message in the prompt
5. Press `Enter` to send - staged images attach automatically

## Commands

### `/ss`

Opens the interactive screenshot picker UI. Browse your recent screenshots with thumbnail previews.

**Keys:**
- **↑↓** - Navigate through screenshots
- **s / space** - Stage current screenshot (✓ indicator appears)
- **o** - Open in Preview.app
- **Enter** - Close picker
- **Esc** - Cancel

### `/ssclear`

Clear all staged screenshots without sending.

### `Ctrl+Shift+S`

Keyboard shortcut to open the picker (same as `/ss`).

## Features

- **Thumbnail previews** - See what you're selecting (Kitty/iTerm2/Ghostty/WezTerm)
- **Multi-select** - Stage multiple screenshots, they all attach when you send
- **Relative timestamps** - "2 minutes ago", "yesterday", etc.
- **File sizes** - Know what you're attaching
- **Staged indicator** - Widget shows `📷 N screenshots staged` below the editor
- **Auto-detection** - Finds your screenshot folder automatically

## Configuration

By default, the extension auto-detects your screenshot location based on your platform.

### Default Locations

**macOS:**
1. System preferences (`defaults read com.apple.screencapture location`)
2. `~/Desktop`

**Linux:**
1. `~/Pictures/Screenshots`
2. `~/Pictures`
3. `~/Screenshots`
4. `~/Desktop`

### Custom Directory

Create `~/.pi/agent/extensions/screenshots.json`:

```json
{
  "directory": "/path/to/your/screenshots"
}
```

Or set the environment variable:

```bash
export PI_SCREENSHOTS_DIR="/path/to/screenshots"
```

### Priority

1. Config file (`~/.pi/agent/extensions/screenshots.json`)
2. Environment variable (`PI_SCREENSHOTS_DIR`)
3. Platform default (see above)

## Supported Screenshot Formats

The extension recognizes screenshots from various tools:

**macOS:**
- English: `Screenshot ...`
- French: `Capture ...`
- German: `Bildschirmfoto ...`
- Spanish: `Captura ...`
- Italian: `Istantanea ...`
- Dutch: `Scherm...`

**Linux:**
- GNOME Screenshot: `2024-01-30_12-30-45.png`
- Flameshot: `flameshot...`
- KDE Spectacle: `spectacle...`
- Scrot: `scrot...`
- Maim: `maim...`
- Grim (Wayland): `grim...`
- Generic: `screenshot...`

Only PNG files matching these patterns are shown.

## Requirements

- macOS or Linux
- Terminal with image support for thumbnails (Kitty, iTerm2, Ghostty, WezTerm)
  - Falls back gracefully on unsupported terminals

## License

MIT
