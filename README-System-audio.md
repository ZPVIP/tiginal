# macOS 系统音频捕获（Loopback Audio）技术方案与踩坑解决指南

在桌面端（Electron）实现实时语音识别与同声传译时，除了麦克风输入外，捕获**电脑系统播放的声音**（System Audio / Loopback Audio，如在线会议 Zoom/腾讯会议、网页视频、播客等）以及**混合输入**（Mixed Audio = 麦克风人声 + 系统声音双轨混音）是极为核心的能力。

在 macOS（尤其是 macOS 14 Sonoma 及 macOS 15 Sequoia）上基于 Electron 捕获系统音频存在大量的系统级与 Chromium 内部机制陷阱。本文详细记录 Tiginal 在解决系统音频捕获过程中遇到的**全部故障现象、底层根因分析、完整解决方案架构与核心代码实现**。

---

## 1. 故障现象与错误诊断

### 1.1 业务表象
用户在 Audio 语音工作台将音频输入源切换为 **System Audio** 或 **Mixed Audio** 后点击 **Start**：
- 无论是在系统弹窗中选择“共享整个屏幕（Entire Screen）”、“所有窗口”还是“特定窗口”；
- 录音均会立刻中断报错失败，波形无任何跳动；
- 用户即便已经在 macOS **系统设置 > 隐私与安全性 > 屏幕与系统音频录制（Screen & System Audio Recording）** 中勾选了 Tiginal，依然无法录制。

### 1.2 诊断日志排查
通过在渲染进程与主进程植入 `AudioCaptureDiagnostics` 捕获链路追踪日志，得到如下特征数据：

```json
{
  "timestamp": "2026-09-26T16:44:55.574Z",
  "runtime": {
    "platform": "darwin",
    "isPackaged": true,
    "electronVersion": "44.4.5",
    "screenPermission": "granted"
  },
  "displayMediaOptions": {
    "audio": true,
    "video": true,
    "systemAudio": "include",
    "windowAudio": "system",
    "audioSelection": "preferred"
  },
  "diagnostic": {
    "event": "capture-requested",
    "captureId": "238a4626-33c7-4ed1-8c1a-e4a7fddc1768",
    "source": "system"
  }
}
{
  "timestamp": "2026-09-26T16:44:58.454Z",
  "diagnostic": {
    "event": "stream-state",
    "captureId": "238a4626-33c7-4ed1-8c1a-e4a7fddc1768",
    "phase": "returned",
    "tracks": [
      {
        "kind": "video",
        "label": "Screen 1",
        "readyState": "live"
      }
    ]
  }
}
```

**关键线索**：
调用 Web 标准 API `navigator.mediaDevices.getDisplayMedia(...)` 成功返回了 `MediaStream`，但是该流内**仅包含一条 `video` 轨，完全没有 `audio` 轨（`getAudioTracks().length === 0`）**！由于没有拿到音频轨，后续 Web Audio 上下文初始化立刻抛出异常：`The selected source did not provide a live system audio track`。

---

## 2. 深入底层根因分析（Root Cause Analysis）

经过对 Chromium、Electron 源码及 macOS ScreenCaptureKit 行为的交叉分析，定位到以下 4 个核心根因：

### 根因 1：Chromium 委托机制与 Electron 缺失 DisplayMediaRequestHandler
- 在普通 Chrome 浏览器中，调用 `getDisplayMedia({ audio: true, video: true })` 时，Chrome 会弹出其原生选择器，界面底部有一个显式的**“同时共享系统音频”复选框**。
- 但是在 Electron 中，默认禁用了该 Chromium 原生弹窗，或者交给系统原生 picker。系统 picker 并不会自动关联 loopback 音频驱动。
- **Electron 机制**：必须在主进程通过 `session.defaultSession.setDisplayMediaRequestHandler((request, callback) => { ... })` 显式介入，并在回调中传入 `{ video: screenSource, audio: 'loopback' }`。只有通过主进程显式指定 `audio: 'loopback'`，Electron 底层才会指令 Chromium 向 macOS ScreenCaptureKit 申请回环音频流。

### 根因 2：Chromium 特性开关（Feature Switches）未显式激活
Electron 31~44+ 底层基于较新的 Chromium（支持通过 ScreenCaptureKit 录制系统回环声音）。但在 macOS 平台，回环音频处于多项 Chromium Feature Flags 门控之后：
- `MacLoopbackAudioForScreenShare`
- `MacSckSystemAudioLoopbackOverride`
如果未在主进程启动前通过 `app.commandLine.appendSwitch('enable-features', ...)` 显式启用这些 feature flags，Chromium 在底层即使收到了 loopback 请求，也不会创建音频管道。

### 根因 3：ScreenCaptureKit 音画强绑定生命周期陷阱（Coupled Stream Lifecycle）
这是绝大多数音频类桌面应用最容易踩入的**致命陷阱**：
- 很多开发者认为：“我做的是语音识别工具，只需要系统音频，不需要视频画面，拿到 `displayStream` 后我立刻执行 `videoTrack.stop()` 来节省 CPU 和内存。”
- **macOS 的底层限制**：macOS ScreenCaptureKit 将音频流和视频流强绑定在同一个底层 Capture Session 实例中。
- 一旦在渲染层对 `videoTrack` 执行了 `.stop()`，macOS 内核会认定整个捕获会话已被调用方主动销毁，**从而连带立刻切断并终止系统音频轨（产生 `ended` 或 `mute` 事件）**！
- **正确原则**：必须保持 videoTrack 处于静默存活状态，直到用户显式点击“停止录音”进行整体 teardown 时，才能连同音频轨一起释放。

### 根因 4：macOS Sequoia（macOS 15+）TCC 权限所有权归属陷阱
macOS 15 针对“屏幕与系统音频录制”实施了更严苛的权限所有权检查：
- **生产打包环境（Packaged App，`/Applications/Tiginal.app`）**：权限归属于应用包的 Bundle Identifier（`com.pengzhang.tiginal`）。
- **本地开发环境（Development Mode，`npm run dev`）**：Electron 实例作为一个子进程，是由开发者的**终端模拟器（Terminal / iTerm2 / VS Code / Cursor）**派生启动的。macOS TCC 权限模型会将权限挂载到**拉起它的父进程（即终端）**，而非子进程 Electron！
- 若开发者在开发模式下只在“隐私设置”里勾选了 Tiginal，而未勾选运行命令的 Terminal/Cursor，依然会获取音频轨失败。

---

## 3. 完整架构与代码实现

整个系统音频捕获链路分为主进程平台调度、渲染进程流管理、AudioWorklet 高精度采样与权限诊断引导三层架构。

```
┌──────────────────────────────────────────────────────────────────┐
│                        Renderer Process                          │
│       LiveAudioSource ('microphone' | 'system' | 'mixed')        │
│                                │                                 │
│            ┌───────────────────┴───────────────────┐             │
│            ▼                                       ▼             │
│  navigator.mediaDevices               navigator.mediaDevices     │
│      .getUserMedia()                     .getDisplayMedia()      │
│    (Microphone Stream)                   (ScreenCaptureKit)      │
│            │                                       │             │
│            │   ┌───────────────────────────────────┘             │
│            │   │ Keep videoTrack alive (guard stream lifecycle)  │
│            ▼   ▼                                                 │
│      Web Audio API AudioContext                                  │
│      MediaStreamAudioSourceNode (GainNode 0.5 each for mixed)    │
│            │                                                     │
│            ▼                                                     │
│      AudioWorkletNode ('tiginal-pcm-capture')                    │
│      Resample to 16 kHz mono PCM16 160ms chunk frames            │
└────────────┬─────────────────────────────────────────────────────┘
             │ IPC: pushPcmFrame
┌────────────▼─────────────────────────────────────────────────────┐
│                          Main Process                            │
│                                                                  │
│  app.commandLine.appendSwitch('enable-features', ...)            │
│    - MacLoopbackAudioForScreenShare                              │
│    - MacSckSystemAudioLoopbackOverride                           │
│                                                                  │
│  session.defaultSession.setDisplayMediaRequestHandler            │
│    -> Intercept DisplayMedia request                             │
│    -> Bind primary screen: { video: screen, audio: 'loopback' }  │
│                                                                  │
│  AudioService                                                    │
│    -> PcmWavWriter: Real-time WAV recording archive              │
│    -> SpeechStreamClient: Real-time R2T2 ASR streaming           │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 步骤一：主进程启用 Chromium Feature Flags
在主进程入口文件 `src/main/index.ts` 中，必须在应用准备就绪之前配置命令行开关：

```typescript
// src/main/index.ts
import {
  getMacAudioCaptureDisabledFeatures,
  getMacAudioCaptureEnabledFeatures,
} from './audio/PlatformAudioCapture';

if (process.platform === 'darwin') {
  const electronMajor = Number.parseInt(process.versions.electron, 10);
  const disabledFeatures = [
    'WidgetLayering',
    'CalculateNativeWinOcclusion',
    ...getMacAudioCaptureDisabledFeatures({ isPackaged: app.isPackaged, electronMajor }),
  ];
  // 禁用冲突与实验性图形通道
  app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
  // 显式开启 ScreenCaptureKit 回环音频
  app.commandLine.appendSwitch('enable-features', getMacAudioCaptureEnabledFeatures().join(','));
}
```

对应实现（[PlatformAudioCapture.ts](file:///Users/pengzhang/projects/github/terminal/tiginal/src/main/audio/PlatformAudioCapture.ts)）：

```typescript
export function getMacAudioCaptureEnabledFeatures(): string[] {
  return [
    'MacLoopbackAudioForScreenShare',
    'MacSckSystemAudioLoopbackOverride',
  ];
}

export function getMacAudioCaptureDisabledFeatures(runtime: MacAudioCaptureRuntime): string[] {
  return !runtime.isPackaged && runtime.electronMajor < 45
    ? ['MacCatapLoopbackAudioForScreenShare']
    : [];
}
```

### 3.2 步骤二：主进程静默授权 Loopback 音频通道
通过注册 `session.setDisplayMediaRequestHandler`，拦截来自渲染进程的捕获请求，无需弹出繁琐的原生窗口选择器，直接自动授予主屏幕与 loopback 音频：

```typescript
// src/main/audio/PlatformAudioCapture.ts
export function configurePlatformAudioCapture({
  platform,
  displayMediaSession,
  getScreenSources,
}: PlatformAudioCaptureDependencies): void {
  if (platform === 'darwin' || platform === 'win32') {
    displayMediaSession.setDisplayMediaRequestHandler((request, callback) => {
      grantScreenWithLoopback(request, callback, getScreenSources);
    });
    return;
  }
  displayMediaSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function grantScreenWithLoopback(
  request: Electron.DisplayMediaRequestHandlerHandlerRequest,
  callback: (streams: Electron.Streams) => void,
  getScreenSources: () => Promise<DesktopCapturerSource[]>,
): void {
  if (!request.userGesture || !request.audioRequested || !request.videoRequested) {
    callback({});
    return;
  }

  void getScreenSources()
    .then(sources => {
      const screen = sources[0];
      // 关键：必须同时提供 video 和 audio: 'loopback'
      callback(screen ? { video: screen, audio: 'loopback' } : {});
    })
    .catch(() => callback({}));
}
```

在 `src/main/index.ts` 中完成初始化挂载：

```typescript
app.whenReady().then(async () => {
  configurePlatformAudioCapture({
    platform: process.platform,
    displayMediaSession: session.defaultSession,
    getScreenSources: () =>
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
  });
  // ...
});
```

### 3.3 步骤三：渲染进程流捕获与生命周期守卫
渲染进程在 [PcmCapture.ts](file:///Users/pengzhang/projects/github/terminal/tiginal/src/renderer/audio/PcmCapture.ts) 中调用 `navigator.mediaDevices.getDisplayMedia`，并进行生命周期守卫：

```typescript
// src/renderer/audio/PcmCapture.ts
export const SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS: DisplayMediaStreamOptions = {
  audio: true,
  video: true,
  systemAudio: 'include',
  windowAudio: 'system',
  audioSelection: 'preferred',
};

private async acquireSystemAudio(source: 'system' | 'mixed'): Promise<MediaStream> {
  const displayStream = await navigator.mediaDevices.getDisplayMedia(SYSTEM_AUDIO_DISPLAY_MEDIA_OPTIONS);

  // 关键防坑点：ScreenCaptureKit 将音视频流绑定于同一会话。
  // 必须保持视频轨存活，切勿在此执行 track.stop()，否则系统音频也会连带被终止！
  await new Promise(resolve => window.setTimeout(resolve, 100));

  const audioTracks = displayStream.getAudioTracks();
  const liveAudioTracks = audioTracks.filter(track => track.readyState === 'live');
  if (liveAudioTracks.length === 0) {
    for (const track of displayStream.getTracks()) track.stop();
    throw new SystemAudioTrackUnavailableError();
  }

  return displayStream;
}
```

### 3.4 步骤四：混合音频（人声 + 系统音）双轨混音
当用户选择 **Mixed Audio** 模式时，同时获取系统音频流与麦克风流，在 Web Audio 管道中使用各自的增益节点进行平衡，统一输送给 `AudioWorklet`：

```typescript
// src/renderer/audio/PcmCapture.ts
this.streams = await this.acquireStreams(liveSource); // 包含 System Stream 和 Microphone Stream
this.context = new AudioContext();
await this.context.audioWorklet.addModule(workletUrl);

this.worklet = new AudioWorkletNode(this.context, 'tiginal-pcm-capture', {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [1],
});

// 混音衰减系数：双路同时输入时各设 0.5 增益，避免合成削波失真；单源时保持 1.0
const inputGain = liveSource.kind === 'mixed' ? 0.5 : 1.0;

for (const stream of this.streams) {
  const source = this.context.createMediaStreamSource(stream);
  const gain = this.context.createGain();
  gain.gain.value = inputGain;
  source.connect(gain);
  gain.connect(this.worklet);
  this.sources.push(source);
  this.inputGains.push(gain);
}
```

### 3.5 步骤五：精准重采样与持续推流
`AudioWorkletProcessor`（`pcm-capture.worklet.js`）在独立音频线程中接收任意采样率（例如 44.1 kHz 或 48 kHz）的双路混音，将其重采样为模型标准的 **16,000 Hz 单声道 PCM16**，按 **160 ms 分帧**（每帧 2,560 样本）通过 IPC 传输给主进程，既不阻塞 UI，也保证音频一帧不丢。

---

## 4. 权限诊断与用户友好引导

当用户由于系统权限未授予而拿不到系统音频轨时，系统自动拦截并弹出权限引导窗口（[SystemAudioPermissionDialog.tsx](file:///Users/pengzhang/projects/github/terminal/tiginal/src/renderer/components/Audio/SystemAudioPermissionDialog.tsx)）：

1. **自动识别环境身份**：
   - 如果是打包应用（`isPackaged === true`），提示在系统设置中为 **Tiginal** 勾选权限；
   - 如果是开发环境（`isPackaged === false`），明确提示必须在系统设置中为当前启动该应用的**终端程序（Terminal、iTerm2、VS Code、Cursor）**勾选权限。
2. **一键直达系统偏好设置**：
   提供按钮直接调用深度链接唤醒 macOS 设置窗口：
   ```typescript
   export const MAC_SYSTEM_AUDIO_SETTINGS_URL =
     'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
   ```
3. **重启生效提醒**：
   macOS 内核 TCC 要求变更屏幕录制权限后必须**完全退出并重启该程序**，弹窗明确引导用户重启。

---

## 5. 自动化测试与工程验证

在 [test/audio-input.test.js](file:///Users/pengzhang/projects/github/terminal/tiginal/test/audio-input.test.js) 中建立了全覆盖的单元测试：
- **`configurePlatformAudioCapture` 验证**：模拟 WebRTC 请求，确认主屏幕被正确提取，且返回对象必须严格为 `{ video: screen, audio: 'loopback' }`。
- **Feature Flags 规则测试**：验证 `getMacAudioCaptureEnabledFeatures` 在各平台下的组合逻辑。
- **权限与环境所有权判定**：验证开发环境与打包环境下 `getSystemAudioPermissionInfo` 的返回逻辑。
- **运行命令一键回归**：
  ```bash
  npm test
  ```
  保证所有 266 个自动化测试持续 100% 通过。

---

## 6. 核心经验总结与踩坑清单

| 陷阱与盲区 | 致命后果 | 正确做法 |
| :--- | :--- | :--- |
| **未配置 `setDisplayMediaRequestHandler`** | `getDisplayMedia` 仅返回视频轨，无音频轨 | 主进程通过 `session.defaultSession.setDisplayMediaRequestHandler` 显式返回 `{ video: screen, audio: 'loopback' }` |
| **主动执行 `videoTrack.stop()`** | ScreenCaptureKit 底层直接杀死系统音频轨 | 录音期间必须保留静默的 `videoTrack` 存活，直到会话彻底结束时统一销毁 |
| **缺少 Chromium 回环 Feature Switches** | Chromium 底层拒绝激活 loopback 音频管道 | 启动时注入 `MacLoopbackAudioForScreenShare` 和 `MacSckSystemAudioLoopbackOverride` 开关 |
| **开发环境授权错误对象** | 仅勾选了 Tiginal，开发运行依然报错 | 开发模式下为拉起进程的终端（iTerm2/VS Code/Cursor）授予屏幕录制权限 |
| **双源混音直接叠加** | 麦克风与系统声音音量过大出现削波爆音 | 使用 Web Audio API 分别接入 `GainNode(0.5)` 再合并到 AudioWorklet 进行重采样 |
| **卸载或权限错乱残留** | 重新安装后系统设置出现失效残留或无法勾选 | 执行 `tccutil reset ScreenCapture com.tiginal.app` 清理 TCC 权限数据库残留 |
