# Tiginal

A cross-platform terminal emulator built with Electron, xterm.js, and node-pty.

## Features

- 🖥️ Cross-platform (macOS, Windows, Linux)
- ⚡ Native PTY for true terminal experience
- 🎨 Beautiful Catppuccin-inspired theme
- 📜 Smart command history & suggestions
- ⭐ Favorite commands with AI normalization
- 🛡️ Blacklist patterns (regex) for commands & directories
- 🧹 Auto-cleanup of low-frequency history
- 🔐 SSH server management (encrypted storage) - *coming soon*
- ☁️ Multi-device sync - *coming soon*
- 🪟 Split Panes (Cmd+\ for split, Cmd+Opt+Arrow for nav)

## Master Key Encryption

[Master Key Encryption Explained](README-KEY.md)

## Command History & Suggestions

Commands are automatically recorded and suggested as you type (prefix match, sorted by frequency).

### Auto-filter (not recorded)
- `cd` commands (uses separate directory history)
- Multi-line commands (`\n` or trailing `\`)
- Compound commands (`&&` or `||`)
- Commands matching blacklist patterns

### Blacklist
Add regex patterns to exclude specific commands/directories from history.
Example: `git commit -am(.*)` will prevent all such commits from being recorded.

### Cleanup
Configure auto-cleanup in Settings → Terminal → General to remove entries with low usage scores.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd + T` | New Tab |
| `Cmd + W` | Close Tab |
| `Cmd + 1-9` | Switch Tab |
| `Cmd + \` | Split Pane Right |
| `Cmd + Opt + Arrows` | Navigate Panes |
| `Cmd + Shift + W` | Close Pane |

## Development

```bash
# Install dependencies
npm install

# Start in development mode
npm start
```

## Building Releases

```bash
# Build for current platform
npm run dist

# macOS (creates .dmg and .zip)
npm run dist -- --mac

# Windows (creates .exe installer)
npm run dist -- --win

# Linux (creates .AppImage and .deb)
npm run dist -- --linux
```

Output files are in the `release/` directory.

| Platform | Files |
|----------|-------|
| macOS | `Tiginal-x.x.x.dmg`, `Tiginal-x.x.x-mac.zip` |
| Windows | `Tiginal Setup x.x.x.exe` |
| Linux | `Tiginal-x.x.x.AppImage`, `tiginal_x.x.x_amd64.deb` |

## Architecture

```
src/
├── main/           # Electron main process
│   ├── index.ts    # Entry point
│   ├── pty.ts      # PTY management
│   ├── ipc.ts      # IPC handlers
│   └── preload.ts  # Context bridge
├── renderer/       # Frontend
│   ├── terminal.ts # xterm.js wrapper
│   └── styles.css  # Theme
└── shared/         # Shared types

services/           # Service layer (reserved)
├── ssh/            # SSH server management
├── history/        # Command history
└── ai/             # AI suggestions
```

## License

MIT
