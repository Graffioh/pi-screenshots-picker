# pi-screenshots-picker

A [pi coding agent](https://github.com/badlogic/pi-mono/) extension for quickly selecting and attaching screenshots to your prompts. Works on **macOS** and **Linux**. Browse recent screenshots with thumbnail previews, stage multiple images, then type your message - screenshots attach automatically when you send.



https://github.com/user-attachments/assets/365f6fa8-0922-4172-8611-141300aed7f6



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
- **Ctrl+T** - Cycle through source tabs (when multiple sources configured)
- **s / space** - Stage current screenshot (✓ indicator appears)
- **o** - Open in Preview.app
- **d** - Delete screenshot from disk
- **Enter** - Close picker
- **Esc** - Cancel

### `/ssclear`

Clear all staged screenshots without sending.

### `/ss-ssh-sync`

Show script to run on your local machine for SSH sync mode (see [SSH Sync Mode](#ssh-sync-mode-for-remote-development) below).

### `Ctrl+Shift+S`

Keyboard shortcut to open the picker (same as `/ss`).

## Features

- **Multiple sources with tabs** - Configure multiple directories/patterns, switch with Ctrl+T
- **Glob pattern support** - Use patterns like `**/*.png` to match files flexibly
- **SSH sync mode** - Take screenshots locally, sync them to remote where pi runs
- **Thumbnail previews** - See what you're selecting (Kitty/iTerm2/Ghostty/WezTerm)
- **Multi-select** - Stage multiple screenshots, they all attach when you send
- **Relative timestamps** - "2 minutes ago", "yesterday", etc.
- **File sizes** - Know what you're attaching
- **Delete screenshots** - Press `d` to remove unwanted screenshots from disk
- **Staged indicator** - Widget shows `📷 N screenshots staged` below the editor
- **Auto-detection** - Finds your screenshot folder automatically when no config

## Configuration

By default, the extension auto-detects your screenshot location based on your platform.

### Multiple Sources with Tabs

Configure multiple screenshot sources in `~/.pi/agent/settings.json`. Each source becomes a tab in the picker UI - use **Ctrl+T** to cycle through them:

```json
{
  "pi-screenshots": {
    "sources": [
      "~/Desktop/ss",
      "~/Pictures/Screenshots",
      "/path/to/comfyui/output/**/thumbnail_*.png"
    ]
  }
}
```

### Source Types

**Plain directories** - Scans for screenshot-named PNG files:
```json
"~/Desktop/ss"
```

**Glob patterns** - Matches any image file (PNG, JPG, WebP) matching the pattern:
```json
"/path/to/images/**/*.png"
"/mnt/Store/ComfyUI/Output/**/thumbnail_*.png"
```

Glob patterns support:
- `*` - Match any characters in a filename
- `**` - Match any directories recursively
- `?` - Match a single character
- `[abc]` - Match any character in brackets

### Default Locations (when no config)

**macOS:**
1. System preferences (`defaults read com.apple.screencapture location`)
2. `~/Desktop`

**Linux:**
1. `~/Pictures/Screenshots`
2. `~/Pictures`
3. `~/Screenshots`
4. `~/Desktop`

### Environment Variable

You can also use the `PI_SCREENSHOTS_DIR` environment variable as a fallback:

```bash
export PI_SCREENSHOTS_DIR="/path/to/screenshots"
```

### Priority

1. Config in `~/.pi/agent/settings.json` (`pi-screenshots.sources`)
2. Environment variable (`PI_SCREENSHOTS_DIR`)
3. Platform default (see above)

## SSH Sync Mode (for Remote Development)

When you're developing on a remote machine via SSH but want to share screenshots from your local screen:

```
[Your local machine] --sync--> [Remote machine running pi]
     (screenshots)                    (/ss shows them)
```

### Setup

1. **On the remote machine** (where pi runs via SSH), run:
   ```
   /ss-ssh-sync
   ```
   Press `c` to copy the install command to clipboard.

2. **On your LOCAL machine** (in a separate terminal, not SSH), paste and run.

3. **Restart pi on the remote** to see synced screenshots:
   - Exit pi (`Ctrl+C` or `/exit`)
   - Run `pi` again
   - Use `/ss` to see your screenshots

That's it! The sync runs as a background service and starts automatically on login.

### Managing the sync service

After installation, use these commands on your **local machine**:

```bash
~/ss-sync.sh status     # Check if sync is running
~/ss-sync.sh stop       # Stop sync temporarily
~/ss-sync.sh start      # Start sync again
~/ss-sync.sh uninstall  # Remove automatic sync completely
~/ss-sync.sh run        # Run in foreground (for debugging)
```

### How it works

The `install` command sets up a background service:
- **macOS**: LaunchAgent (`~/Library/LaunchAgents/pi-ss-sync-*.plist`)
- **Linux**: systemd user service (`~/.config/systemd/user/pi-ss-sync-*.service`)

The service:
1. Starts automatically when you log in
2. Watches your local screenshot folder using `fswatch`
3. When a screenshot appears, automatically `scp`s it to the remote
4. Logs to `~/.pi/ss-sync/*.log`

```
LOCAL MACHINE                              REMOTE MACHINE
┌──────────────────────┐                   ┌──────────────────────┐
│ LaunchAgent/systemd  │                   │ pi running here      │
│   ↓                  │                   │                      │
│ watches ~/Desktop    │    scp            │ ~/Screenshots/       │
│   ↓                  │ ────────────────► │   Screenshot.png     │
│ new screenshot! ─────│                   │                      │
│   ↓                  │                   │ /ss shows it! ✓      │
│ (auto-restarts)      │                   │                      │
└──────────────────────┘                   └──────────────────────┘
```

### Configuration

You can customize the paths in `~/.pi/agent/settings.json` on the **remote machine** (where pi runs):

```json
{
  "pi-screenshots": {
    "sources": ["~/Screenshots"],
    "sshSync": {
      "localWatch": "~/Screenshots",
      "remoteDir": "~/Screenshots",
      "host": "your-server.com",
      "port": 22
    }
  }
}
```

- `localWatch` - Directory to watch on your local machine (default: `~/Screenshots`)
- `remoteDir` - Directory on remote where screenshots are synced (default: `~/Screenshots`)
- `host` - Hostname/IP your local machine uses to reach the remote (required for Docker containers or AWS instances where the auto-detected hostname won't resolve)
- `port` - SSH port (default: `22`, useful for Docker or custom SSH setups)

### macOS: Protected Directories (Automatic Symlink)

On macOS, **LaunchAgents cannot access `~/Desktop`, `~/Documents`, or `~/Downloads`** without Full Disk Access. The install script **automatically handles this** by creating a symlink:

```
~/Desktop/ss (your configured path)
      ↓ symlink
~/Screenshots (actual storage, accessible by LaunchAgent)
```

**What happens automatically on install:**
1. Creates `~/Screenshots` directory
2. Moves existing screenshots from your configured path to `~/Screenshots`
3. Creates a symlink so macOS still saves to your configured location
4. LaunchAgent watches `~/Screenshots` (no permission issues)

**Example:** If you configure `localWatch: "~/Desktop/ss"`:
- macOS saves screenshot → `~/Desktop/ss/Screenshot.png`
- Symlink redirects → `~/Screenshots/Screenshot.png` (actual file)
- LaunchAgent syncs from `~/Screenshots` ✓

**Alternative approaches:**

1. **Change macOS screenshot location directly:**
   ```bash
   defaults write com.apple.screencapture location ~/Screenshots
   killall SystemUIServer
   ```

2. **Grant Full Disk Access to `/bin/bash`:**
   - System Settings → Privacy & Security → Full Disk Access
   - Click `+`, press `Cmd+Shift+G`, type `/bin/bash`
   - (Grants access to all bash scripts - less secure)

### Docker / Cloud VM Setup

When the remote is a Docker container or cloud instance, the auto-detected hostname often won't resolve from your local machine. You must specify the `host` explicitly:

**Docker example:**
```json
{
  "pi-screenshots": {
    "sshSync": {
      "host": "localhost",
      "port": 2222
    }
  }
}
```

**AWS EC2 example:**
```json
{
  "pi-screenshots": {
    "sshSync": {
      "host": "ec2-1-2-3-4.compute.amazonaws.com"
    }
  }
}
```

### Requirements for SSH Sync

- SSH key authentication set up between local and remote
- `fswatch` on local machine (cross-platform: macOS, Linux, BSD, Windows)
  - **Auto-installed** by the script if not present
  - Or install manually:
    ```bash
    # macOS
    brew install fswatch
    
    # Linux (Debian/Ubuntu)
    sudo apt install fswatch
    
    # Linux (Fedora)
    sudo dnf install fswatch
    
    # Linux (Arch)
    sudo pacman -S fswatch
    ```

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
- For SSH sync mode: SSH key auth + fswatch on local machine (auto-installed by script)

### Thumbnail Previews over SSH

To enable thumbnail previews over SSH, add your terminal to the remote's shell profile:

```bash
# Add to remote ~/.bashrc or ~/.zshrc
export TERM_PROGRAM=ghostty  # or: kitty, WezTerm, iTerm.app
```

Restart pi after (can't use `!` inside pi). The install script will show the exact command for your terminal.

## License

MIT
