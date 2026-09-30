# Tiginal

English | [中文](README.zh.md)

> **All-in-One AI-Powered Developer Workstation & Swiss Army Knife for the AI Era**  
> Unifying an **Intelligent AI Agent + Audio & Speech Lab + Native Fast Terminal + Local Model Engine + Secret Vault** into a single cohesive experience—eliminating the friction of switching across terminals, web browsers, translation tools, and ad-hoc scripts.

---

## 🌟 Key Features

### 1. 🤖 AI Chat & Agent Assistant (AI Copilot & MCP)
- **Multi-Model Immersive Chat**: Seamlessly interacts with top-tier cloud models and local offline LLMs. Supports real-time Reasoning Effort / chain-of-thought folding, multi-session isolation, syntax highlighting, and instant copy feedback.
- **Model Context Protocol (MCP) Ecosystem**:
  - Full native support for the open MCP standard, unlocking endless external tools and data sources.
  - Supports both **stdio** (local subprocess) and **Streamable HTTP / SSE** (remote server) transports.
  - Fine-grained per-server tool toggles and reusable profile snapshots.
- **Built-in Web Search & Deep Fetching**:
  - `WebSearch`: High-speed concurrent search aggregation across DuckDuckGo, Google, and Bing without browser overhead, extracting titles, URLs, and summaries.
  - `WebFetch`: Built-in full Chromium rendering environment to scrape dynamic SPAs and JavaScript-heavy pages.
- **Human-in-the-Loop Security Approval**: Intelligently inspects high-risk commands and file operations (Tool-aware approval), auto-authorizing safe read-only operations while prompting for confirmation on destructive actions.

---

### 2. 🎙️ Audio & Speech Lab
- **All-Scenario Tri-Source Audio Capture**:
  - 🎤 **Microphone Capture**: Everyday voice notes and personal speaking.
  - 🔊 **System Audio Recording**: Built on macOS ScreenCaptureKit—**no virtual audio drivers (such as BlackHole or Soundflower) needed** to record computer audio directly (video calls, webinars, podcasts, web streams).
  - 🔀 **Mixed Audio Capture**: Records microphone voice + computer speaker playback simultaneously—the ultimate companion for two-way interviews, meetings, and tutorials.
- **Local Offline Whisper Transcription**:
  - Zero privacy leakage. Dispatches local lightweight and high-precision Whisper models directly on-device with no internet connectivity required.
- **Remote / Self-Hosted Streaming STT (R2T2)**：
  - Sub-second word-by-word streaming transcriptions; built-in repetitive flooding suppression and seamless rollover for extended recording sessions.
- **Speaker Diarization & SRT Generation (Nemotron-3 + MMS-Align)**:
  - Deeply integrated with the native high-performance Rust engine `tiginal-diarize`, combining acoustic forced alignment with Nemotron-3 speaker separation.
  - Generates labeled conversational transcripts (`-diar.txt`) and standard subtitle files (`.srt`) with intelligent sentence-level line wrapping to prevent horizontal overflow.
  - Supports one-click **Redo Diarization** on existing text and real-time **Cancel** controls.
- **Real-Time & Static Simultaneous Translation (T3PO)**:
  - Bidirectional English-Chinese streaming simultaneous translation with configurable latency modes (`low`, `native`, `high`).
  - Supports custom Technical Terms dictionaries (`source=target`) and customized Translation Instructions.
- **Intelligent Audio Artifact Management**:
  - **Auto-Artifact Discovery**: Loading any local audio file immediately scans and loads existing `.txt`, `-diar.txt`, and `.srt` files into their respective tabs.
  - **Granular Artifact Deletion**: Delete individual tab files with clear confirmation dialogs displaying the exact filename; multi-file deletion dialogs present each related file on its own line; external audio files hide full-delete buttons to prevent accidental loss.
  - **Global 3-Second Copy Feedback**: Instant green checkmark indicator that locks for 3 seconds before restoring to prevent accidental duplicate clicks.

---

### 3. ⚡ Smart Terminal
- **Native PTY Performance**: Powered by Electron + xterm.js + node-pty, delivering lightning-fast, native command-line responsiveness.
- **Split Panes Matrix**: Split workspaces horizontally and vertically, navigating between panes with rapid keyboard shortcuts.
- **Smart History & Frequency-Based Suggestions**: Contextual auto-suggestions sorted by real-world usage patterns.
- **Regex Blacklist Filtering**: Define custom regex rules to exclude passwords, API tokens, or one-off commands from cluttering shell history.
- **Automated Low-Frequency Cleanup**: Built-in score-based decay engine that purges stale and rare commands automatically.
- **Elegant Themes**: Crafted with Catppuccin color palettes and polished micro-animations.

---

### 4. 🧠 Local Models & Engines (Model Library & Engines)
- **Smart Model Asset Scanning**: Automatically detects local GGUF models, Hugging Face caches, and custom directories with commit-hash revision detection and multi-quantization categorization (e.g. Q4_K_M, Q8_0).
- **Resumable Chunked Downloads**: Robust Range & ETag-backed downloading engine for multi-gigabyte models that resumes cleanly after network interruptions.
- **Engine Lifecycle Supervisor**: Directly hosts and schedules local runtimes (such as llama.cpp and tiginal-diarize) while tracking process health and hardware utilization.

---

### 5. 🔐 Master Key & Credentials Vault
- **Master Key-Derived Encryption**: Uses master-key AES encryption to securely protect all API tokens, SSH keys, and sensitive environment configs.
- **Zero-Trust Ephemeral Materialization**: Securely injects temporary environment variables and files on demand only during task execution, immediately purging them upon completion to eliminate the risk of committing plaintext `.env` files.

---

## ⚙️ Exploring Settings: Endless Possibilities

Tiginal provides extensive customization options through its settings interface:

| Settings Tab | Capabilities & Configuration Possibilities |
|---|---|
| **AI Providers** | • Pre-configured integrations with OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Groq, OpenRouter, and more.<br>• Native **GitHub Copilot** authentication workflow.<br>• Connect any OpenAI-compatible local or private endpoints (e.g. vLLM, Ollama, LocalAI).<br>• Automatically syncs models.dev metadata to configure context limits, token limits, and Reasoning Effort. |
| **Model Library & Engines** | • Scan and index local model directories.<br>• Download GGUF models with automatic resume and version grouping.<br>• Manage local inference runtimes: executable paths, startup flags, and platform optimizations. |
| **Speech Providers** | • Select STT backends: Local offline Whisper or remote R2T2 streaming endpoints.<br>• Configure preferred languages, concurrency, and rollover policies.<br>• Configure T3PO translation endpoints (WebSocket streaming or LLM backends). |
| **MCP & Agent Skills** | • Add, edit, and orchestrate MCP servers (local stdio commands or remote SSE URLs).<br>• Enable or disable individual tools with profile snapshots.<br>• Import and mount domain-specific Agent Skills. |
| **Credentials Vault** | • Master Key initialization, locking, and status monitoring.<br>• Manage isolated environment variable groups (Production, Staging, Local).<br>• Audit materialization events and credential usage logs. |
| **Terminal & Shortcuts** | • Choose preferred shell binary (zsh, bash, fish, PowerShell).<br>• Customize fonts, font sizes, cursors, and Catppuccin themes.<br>• Configure history scoring parameters and blacklist regexes.<br>• Remap global keyboard shortcuts. |
| **System & Permissions** | • Diagnose and manage macOS Screen and System Audio capture permissions with guided recovery. |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd + T` | New Terminal Tab |
| `Cmd + W` | Close Tab |
| `Cmd + 1-9` | Switch to Tab |
| `Cmd + \` | Split Pane Right |
| `Cmd + Opt + Arrows` | Navigate Across Panes |
| `Cmd + Shift + W` | Close Current Pane |

---

## 🚀 Installation (macOS)

Download official prebuilt binaries from [GitHub Releases](https://github.com/ZPVIP/tiginal/releases):
- Apple Silicon (M1/M2/M3/M4): `Tiginal-x.x.x-arm64.dmg`
- Intel Macs: `Tiginal-x.x.x.dmg`

Because the app is distributed with ad-hoc signing, macOS may gate the first launch. If prompted, go to **System Settings > Privacy & Security** and click **Open Anyway**. If macOS reports the bundle is damaged, run:
```bash
xattr -dr com.apple.quarantine /Applications/Tiginal.app
```

> **Important: System Audio Capture Permission**  
> When first attempting system audio recording, check and enable Tiginal under **System Settings > Privacy & Security > Screen & System Audio Recording**. Quit and reopen Tiginal after modifying permissions.

---

## 🛠️ Development & Building from Source

Prerequisites: Node.js >= 22, Git.

```bash
# 1. Clone the repository
git clone https://github.com/ZPVIP/tiginal.git
cd tiginal

# 2. Install dependencies and run tests
npm ci
npm test

# 3. Start development mode
npm start

# 4. Package distribution binaries
npm run dist
```

Output packages will be generated inside the `release/` directory.

---

## 🗑️ Complete Uninstall (macOS)

To cleanly remove Tiginal along with system permissions and caches:

```bash
# 1. Reset Screen & System Audio Recording TCC permissions
tccutil reset ScreenCapture com.tiginal.app

# 2. Remove application bundle
rm -rf /Applications/Tiginal.app

# 3. Clean up app configurations, databases, and caches
rm -rf ~/Library/Application\ Support/Tiginal
rm -rf ~/Library/Caches/Tiginal
rm -rf ~/.cache/tiginal
```

---

## 🏗️ Architecture

```
tiginal/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── audio/            # Audio capture, R2T2, T3PO, AlignmentEngine, PlatformCapture
│   │   ├── models/           # Model library scanner, resumable downloader, engine supervisor
│   │   ├── services/         # MCP client, credential encryption & materialization
│   │   ├── pty.ts            # Native PTY orchestration
│   │   └── preload.ts        # Secure context bridge
│   ├── renderer/             # React renderer process
│   │   ├── components/Audio/ # Audio workspace, waveforms, transcript/speakers/SRT editors
│   │   ├── components/Chat/  # AI chat interface & MessageBubble
│   │   ├── components/Settings/ # Settings management panels
│   │   └── components/Terminal/ # xterm.js terminal integration & pane management
│   └── shared/               # Shared type definitions and IPC schemas
└── tiginal-diarize/          # High-performance Rust diarization and alignment engine
```

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)** - see the [LICENSE](LICENSE) file for details.

Third-party libraries, dependencies, and AI model weight licensing details are documented in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
