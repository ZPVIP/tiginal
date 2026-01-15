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

# Build for distribution
npm run dist
```

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
