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

## AI Web Tools

- `WebSearch` uses `fetch()` to request DuckDuckGo, Google, or Bing search-result HTML. Cheerio extracts the title, URL, and snippet from each result, which Tiginal returns to the model in a numbered format. It does not open each result page.
- `WebFetch` loads a specific URL in a hidden Electron `BrowserWindow`. It waits for JavaScript-rendered content, then returns the page title, URL, and body text to the model.

`WebSearch` is faster and works well for discovery. Use `WebFetch` when the model needs the content of a specific page.

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

## Install on macOS

Download the `.dmg` for your Mac from [Releases](https://github.com/ZPVIP/tiginal/releases): `Tiginal-x.x.x-arm64.dmg` for Apple silicon, `Tiginal-x.x.x.dmg` for Intel.

The app is not signed with an Apple Developer ID yet, so macOS blocks the first launch. Open Tiginal once, then go to System Settings > Privacy & Security and click Open Anyway. If macOS reports that the app is damaged, remove the download quarantine and open it again:

```bash
xattr -dr com.apple.quarantine /Applications/Tiginal.app
```

## Build from Source

Official packages are published for macOS only. On Windows and Linux, build Tiginal yourself. You need Node.js 24 and Git; the native modules ship prebuilt binaries, so no C++ toolchain is required.

```bash
git clone https://github.com/ZPVIP/tiginal.git
cd tiginal
npm ci
npm run dist
```

`npm run dist` compiles the app and packages it for the current platform without uploading anything. Output files are in the `release/` directory.

| Platform | Files |
|----------|-------|
| macOS | `Tiginal-x.x.x-arm64.dmg`, `Tiginal-x.x.x.dmg`, and matching `.zip` files |
| Windows | `Tiginal Setup x.x.x.exe` |
| Linux | `Tiginal-x.x.x.AppImage`, `tiginal_x.x.x_amd64.deb` |

## Publishing a Release (maintainers)

Releases are built on a maintainer's Mac and uploaded to a draft GitHub release. Continuous integration is not used.

One-time setup: create a fine-grained GitHub token limited to `ZPVIP/tiginal` with the Contents: Read and write permission, then store it in the login keychain. The command prompts for the token, so it never appears in shell history:

```bash
security add-generic-password -a "$USER" -s tiginal-github-release -w
```

For each release, set the version, push the commit and tag, and run the release script:

```bash
npm version 0.2.0
git push --follow-tags
npm run release
```

`npm run release` refuses to run with uncommitted changes or an unpushed tag. It reinstalls dependencies, runs the tests, builds the x64 and arm64 packages, and uploads them to a draft release named after the tag. Review the draft on GitHub, then publish it there or with `gh release edit v0.2.0 --draft=false`.

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
