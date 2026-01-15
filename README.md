# Tigi Terminal

A cross-platform terminal emulator built with Electron, xterm.js, and node-pty.

## Features

- 🖥️ Cross-platform (macOS, Windows, Linux)
- ⚡ Native PTY for true terminal experience
- 🎨 Beautiful Catppuccin-inspired theme
- 🔐 SSH server management (encrypted storage) - *coming soon*
- 📜 Command history with AI suggestions - *coming soon*
- ☁️ Multi-device sync - *coming soon*

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
| macOS | `Tigi Terminal-x.x.x.dmg`, `Tigi Terminal-x.x.x-mac.zip` |
| Windows | `Tigi Terminal Setup x.x.x.exe` |
| Linux | `Tigi Terminal-x.x.x.AppImage`, `tigi-terminal_x.x.x_amd64.deb` |

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
