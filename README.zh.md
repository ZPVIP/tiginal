# Tiginal

[English](README.md) | 中文

> **AI 时代的百宝箱与全能开发者工作站 (All-in-One AI-Powered Developer Workstation)**  
> 融合「智能 Agent 助手 + 语音与音频处理工坊 + 原生极速终端 + 离线模型引擎 + 密钥保险箱」，让开发者告别在各种网页、终端、翻译软件与脚本间来回切换的割裂体验。

---

## 🌟 核心功能一览

### 1. 🤖 AI Chat 与 Agent 助手 (AI Copilot & MCP)
- **多模型沉浸式对话**：原生支持主流顶级模型与本地模型，完美支持思维链（Reasoning Effort）实时展开，提供多会话隔离、Markdown 代码高亮与全局快速复制反馈。
- **Model Context Protocol (MCP) 原生生态**：
  - 深度支持 MCP 协议标准，无缝连接任意外部工具生态。
  - 支持 **stdio**（本地命令行进程）与 **Streamable HTTP / SSE**（远程服务器）传输模式。
  - 细粒度控制每个 MCP 服务器的工具启用/禁用，支持配置文件快照（Profile Snapshots）。
- **内置 Web 搜索与深度嗅探**：
  - `WebSearch`：轻量级并发搜索聚合（支持 DuckDuckGo、Google、Bing），免浏览器快速提取标题、URL 与摘要。
  - `WebFetch`：内置完整 Chromium 渲染环境抓取复杂 SPA / JavaScript 网页正文。
- **人机协同安全审核**：智能识别模型调用的高危操作与系统命令（Tool-aware approval），自动放行只读安全指令，拦截并提示高危操作。

---

### 2. 🎙️ 语音与音频处理工坊 (Audio & Speech Lab)
- **全场景三路音频采集**：
  - 🎤 **麦克风采集（Microphone）**：日常语音备忘、会议个人发言。
  - 🔊 **系统音频内录（System Audio）**：深度结合 macOS ScreenCaptureKit，**无需安装 BlackHole、Soundflower 等虚拟声卡**，即可直接内录电脑声音（在线视频、远程会议、播客、网页音频）。
  - 🔀 **混合内录采集（Mixed Audio）**：同时抓取麦克风人声 + 扬声器系统声音，双向会议、面对面访谈与在线课程教学的终极记录方案。
- **本地离线 Whisper 极速转录**：
  - 保护隐私，离线零泄露。本地直接调度轻量/高精度 Whisper 引擎，无网络环境亦可稳定高效出字。
- **自建/远端流式语音识别 (R2T2)**：
  - 毫秒级字词流式上屏；内置防重复 Flooding 抑制算法与超长语音无缝平滑切片轮转（Rollover）。
- **角色分离与标准字幕生成 (Nemotron-3 + MMS-Align)**：
  - 深度集成自研高性能 Rust 组件 `tiginal-diarize`，结合声学特征对齐与 Nemotron-3 语义分离。
  - 一键输出分角色对话文本（`-diar.txt`）以及标准播放器字幕（`.srt`），长句自动智能切分换行，告别横向溢出。
  - 支持针对已有文本一键 **Redo Diarization** 与随时 **Cancel** 中止。
- **实时与静态同传翻译 (T3PO)**：
  - 中英双向流式同声传译，提供 low / native / high 三档延迟模式。
  - 支持注入专业术语表（Technical Terms，源词=目标词）和自定义翻译约束（Translation Instructions）。
- **音频资产智能联动与安全管理**：
  - **自动关联加载**：打开任意本地音频文件，秒级自动扫描同目录下的 `.txt`、`-diar.txt`、`.srt` 并加载进对应 Tab，即开即看。
  - **精细化产物删除**：按激活标签页单独删除对应文件，明确弹出待删文件名；底栏录音删除逐行展示关联文件；外部音频文件自动隐藏整包删除按钮以防误删。
  - **全局通用复制反馈**：点击复制图标即刻变绿勾并锁定 3 秒后复原，防止误触。

---

### 3. ⚡ 智能终端引擎 (Smart Terminal)
- **原生 PTY 极速性能**：基于 Electron + xterm.js + node-pty 构建，享受与原生终端无异的毫秒级击键响应。
- **分屏矩阵 (Split Panes)**：支持水平/垂直切分多窗格，配合快捷键随心穿梭，多任务并发执行。
- **智能历史与频次补全**：根据命令使用频率与前缀智能推荐，击键即达。
- **正则黑名单过滤**：支持自定义正则表达式黑名单，自动忽略含密码、密钥或特定一次性命令（如敏感提交），避免污染历史记录。
- **低频记录自动清理**：基于使用热度评分系统，自动清理无用冗余命令。
- **优雅视觉设计**：经典 Catppuccin 配色与细腻微动效，赏心悦目。

---

### 4. 🧠 本地模型调度中心 (Model Library & Engines)
- **本地模型资产智能扫描**：自动识别本地 GGUF 模型、Hugging Face 缓存目录与自定义路径；支持 Commit-hash 版本识别与多量化等级（Q4_K_M、Q8_0 等）归类。
- **稳健断点续传**：基于 Range & ETag 机制，多吉字节大模型文件断网自动恢复续传，不浪费带宽。
- **本地引擎与运行时编排 (Engine Supervisor)**：直接托管与调度本地推理运行时（如 llama.cpp、tiginal-diarize），监控进程资源与生命周期。

---

### 5. 🔐 主密钥与环境凭据保险箱 (Credentials & Key Vault)
- **Master Key 派生加密**：采用主密钥派生与 AES 高强度加密，安全存储所有 API 密钥、SSH 私钥与隐私配置。
- **零信任凭据物化 (Materializer)**：在任务执行时按需注入隔离的临时环境变量与临时文件，任务结束后立即物理销毁，彻底根除明文 `.env` 意外提交至 Git 仓库的安全隐患。

---

## ⚙️ 设置面板（Settings）：探索无限可能

Tiginal 提供深度的个性化配置，释放百宝箱的全部潜能：

| 设置板块 | 功能与配置可能性 |
|---|---|
| **AI Providers** | • 支持主流云端模型：OpenAI、Anthropic Claude、Google Gemini、DeepSeek、Groq、OpenRouter 等。<br>• 原生集成 **GitHub Copilot** 授权认证。<br>• 灵活接入任意兼容 OpenAI 协议的本地端点（如 vLLM、Ollama、Local Server）。<br>• 自动同步 models.dev 元数据，动态识别模型上下文、最大 Token 限制与推理强度（Reasoning Effort）。 |
| **Model Library & Engines** | • 本地模型库路径扫描（支持多路径、多级子目录）。<br>• GGUF 格式模型检索、断点续传下载与多量化版本管理。<br>• 推理引擎管理：运行路径配置、启动命令行参数模板、平台适配。 |
| **Speech Providers** | • 语音识别后端切换：内置 Local Whisper（完全离线）或外部 R2T2 服务端点。<br>• 语言偏好设置、并发数配置、长录音自动分割策略。<br>• T3PO 翻译引擎配置（选择流式同传协议或 LLM 翻译后端）。 |
| **MCP & Agent Skills** | • 自由添加、编辑、管理 MCP 服务器（本地 stdio 进程或远程 SSE 链接）。<br>• 细粒度开启/禁用单项 Tool，管理工具 Profile 快照。<br>• 导入与挂载特定任务的 Agent Skills。 |
| **Credentials Vault** | • Master Key 初始化与解锁状态管理。<br>• 多项目隔离的环境变量组（Production / Staging / Local）。<br>• 凭据物化审计日志，随时查看密钥注入历史。 |
| **Terminal & Shortcuts** | • Shell 解释器选择（zsh, bash, fish, powershell）。<br>• 字体家族、字号、光标样式与主题定制。<br>• 历史记录评分权重与正则黑名单配置。<br>• 全局键盘快捷键自定义。 |
| **System & Permissions** | • macOS 屏幕录制与系统音频录制权限状态检测与重置引导。 |

---

## ⌨️ 常用快捷键

| 快捷键 | 功能操作 |
|---|---|
| `Cmd + T` | 新建终端标签页 |
| `Cmd + W` | 关闭当前标签页 |
| `Cmd + 1-9` | 切换指定标签页 |
| `Cmd + \` | 向右水平拆分窗格 (Split Pane) |
| `Cmd + Opt + 方向键` | 在拆分窗格间自由导航 |
| `Cmd + Shift + W` | 关闭当前拆分窗格 |

---

## 🚀 安装指南 (macOS)

可从 [GitHub Releases](https://github.com/ZPVIP/tiginal/releases) 下载最新构建：
- Apple Silicon (M1/M2/M3/M4): `Tiginal-x.x.x-arm64.dmg`
- Intel 芯片: `Tiginal-x.x.x.dmg`

由于应用采用了自签名，首次在 macOS 上启动时如遇系统拦截，请前往 **系统设置 > 隐私与安全性**，点击 **仍要打开**。若提示应用已损坏，可在终端执行：
```bash
xattr -dr com.apple.quarantine /Applications/Tiginal.app
```

> **注意：系统音频录制权限**  
> 首次尝试使用系统音频内录时，请在 **系统设置 > 隐私与安全性 > 屏幕与系统音频录制** 中勾选允许 **Tiginal**。更改权限后请重启应用。

---

## 🛠️ 本地开发与从源码构建

需要环境：Node.js >= 22，Git。

```bash
# 1. 克隆代码仓库
git clone https://github.com/ZPVIP/tiginal.git
cd tiginal

# 2. 安装依赖并执行测试
npm ci
npm test

# 3. 启动开发模式
npm start

# 4. 构建打包分发文件
npm run dist
```

打包产物位于 `release/` 目录下。

---

## 🗑️ 完全卸载指南 (macOS)

若需彻底移除 Tiginal 及其系统权限与缓存数据：

```bash
# 1. 重置 macOS 屏幕与系统音频录制 TCC 权限
tccutil reset ScreenCapture com.tiginal.app

# 2. 删除应用程序包
rm -rf /Applications/Tiginal.app

# 3. 清理应用配置、本地数据库与缓存
rm -rf ~/Library/Application\ Support/Tiginal
rm -rf ~/Library/Caches/Tiginal
rm -rf ~/.cache/tiginal
```

---

## 🏗️ 架构概览

```
tiginal/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── audio/            # 音频管线、R2T2、T3PO、AlignmentEngine、PlatformCapture
│   │   ├── models/           # 模型库扫描、断点续传、引擎目录编排
│   │   ├── services/         # MCP 客户端、凭据安全加密与物化
│   │   ├── pty.ts            # 原生终端 PTY 调度
│   │   └── preload.ts        # 安全 Context Bridge
│   ├── renderer/             # React 前端渲染进程
│   │   ├── components/Audio/ # 音频工作区、波形绘制、字幕/说话人/翻译编辑器
│   │   ├── components/Chat/  # AI 对话界面与 MessageBubble
│   │   ├── components/Settings/ # 全维度设置面板
│   │   └── components/Terminal/ # xterm.js 终端集成与分屏管理
│   └── shared/               # 进程间共享类型与接口定义
└── tiginal-diarize/          # 高性能 Rust 说话人分离与对齐引擎
```

---

## 📄 开源许可

本项目遵循 **GNU General Public License v3.0 或更高版本 (GPL-3.0-or-later)** 开源 - 详情请参阅 [LICENSE](LICENSE) 文件。

项目所引用的第三方依赖库授权条款与 AI 模型权重许可说明详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。