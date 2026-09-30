---
name: macos-permissions
description: Diagnose, fix, and maintain macOS system permissions (Screen & System Audio Recording, Microphone, TCC) in Tiginal, covering code signing, CDHash invalidation, and development vs packaged modes.
---

# macOS Permissions & TCC Architecture

Guidelines and troubleshooting rules for macOS system permissions (Transparency, Consent, and Control / TCC), specifically **Screen & System Audio Recording** and **Microphone** in Tiginal.

---

## 1. 核心根因：为什么“在系统设置中添加 Tiginal 没有用”？

在 macOS（尤其是 macOS 14 Sonoma 和 macOS 15 Sequoia）中，如果出现**“已经在屏幕录制设置中勾选或手动添加了 Tiginal，但系统依然报没有权限、录不到声音”**，根本原因是 **TCC 权限绑定的签名标识（Designated Requirement）不匹配**。

### ① Ad-Hoc 签名的 CDHash 陷阱
- 当使用 Ad-Hoc 签名（`codesign --sign -`）打包时，应用没有有效的 Apple 证书颁发机构。
- macOS TCC 数据库无法按证书识别应用，只能将权限强制绑定到可执行文件的 **CodeDirectory Hash (CDHash)**：
  ```
  # designated => cdhash H"7971de476876dee9e77f340ae0803a5e1aadf7cf"
  ```
- **每次重新打包或更新构建**，代码、资源或时间戳一旦变化，生成的 **CDHash 就会改变**。
- 但 macOS 系统数据库 `TCC.db` 中依然记录着旧版本的 CDHash。
- 当新版 Tiginal 启动并请求 `getDisplayMedia` 时，macOS 检测到当前运行进程的 CDHash 与 TCC 记录不符，视为未授权或被篡改应用，直接拒绝提供系统音频流。

### ② 系统设置 UI 的假象
- 在“系统设置 > 隐私与安全性 > 屏幕与系统音频录制”中，UI 列表中显示的“Tiginal”条目实际上指向的是**旧 CDHash**。
- 用户在界面上反复开关开关、或者点击“+”号重新添加 `/Applications/Tiginal.app`，macOS 的系统设置面板**不会主动更新 TCC.db 中的 CDHash**。
- 这就导致了现象：**“明明看着勾选上了，但完全不起作用”**。

---

## 2. 根本解法：使用证书签名消灭 CDHash 绑定

### ① 证书签名机制
当使用有效的 Apple 证书（无论是 `Developer ID Application` 还是本地的 `Apple Development: ...`）对应用进行签名时：
```bash
codesign --force --deep --sign "Apple Development: zpadmin@gmail.com (SDWF3WKSPN)" /Applications/Tiginal.app
```
macOS 生成的 Designated Requirement 变为：
```
designated => identifier "com.tiginal.app" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: ..."
```
**其中不包含任何 CDHash！** 只要 Bundle ID 保持 `com.tiginal.app` 且使用相同的 Apple 证书签名，无论本地重新编译打包多少次，macOS TCC 都会永远、无缝识别同一授权，**彻底杜绝权限丢失和重复授权问题**。

### ② 打包脚本自动检测策略（`scripts/adhoc-sign-mac.cjs`）
在打包脚本中自动探查本机 Keychain，优先匹配 Apple 证书：
1. 环境变量显式指定的证书（`APPLE_SIGNING_IDENTITY` / `CSC_NAME`）；
2. Keychain 中的 `Developer ID Application`；
3. 本机匹配当前用户的 `Apple Development` 证书；
4. 任何有效的代码签名身份；
5. 若全无，才兜底使用 Ad-Hoc（`-`）。

---

## 3. 开发模式（Development） vs 生产包（Packaged）的归属差异

| 运行方式 | 启动载体 | TCC 权限归属目标 | 正确授权方式 |
| :--- | :--- | :--- | :--- |
| **安装包运行** (`/Applications/Tiginal.app`) | launchd / Dock / Finder | `com.tiginal.app` (Tiginal 本身) | 系统设置中勾选 **Tiginal** |
| **源码运行** (`npm start` / `npm run dev`) | 终端 (Terminal / iTerm2 / VS Code / Cursor) | **父进程终端应用** | 系统设置中必须勾选**启动它的终端**（如 iTerm 或 Cursor） |

> **注意**：如果在终端运行 `npm start`，但在系统设置中去勾选 `/Applications/Tiginal.app`，是绝对不会生效的！因为此时权限校验的是终端进程。

---

## 4. 故障排查与急救恢复流程

当遇到权限失效或反复弹窗时，按以下标准顺序排查：

### 第一步：检查当前应用的签名类型
```bash
codesign -d -r- /Applications/Tiginal.app
```
- 如果输出包含 `cdhash H"..."`，说明是 **Ad-Hoc 签名**，必须重新打上证书签名或重置 TCC；
- 如果输出包含 `anchor apple generic` 和证书 CN，说明签名正常。

### 第二步：清理 TCC 数据库残留（急救核心命令）
Ad-Hoc 切换为证书签名后，或者应用 ID 变更后，必须清理旧条目：
```bash
# 重置 Tiginal 的屏幕与系统音频录制权限
tccutil reset ScreenCapture com.tiginal.app

# 若之前曾使用过 com.pengzhang.tiginal，也一并清理
tccutil reset ScreenCapture com.pengzhang.tiginal
```

### 第三步：为应用写入稳定签名
```bash
# 自动寻找本机开发证书并完成深层签名
codesign --force --deep --sign "Apple Development: zpadmin@gmail.com (SDWF3WKSPN)" /Applications/Tiginal.app
```

### 第四步：重新授权与生效
1. 打开 `/Applications/Tiginal.app`；
2. 触发一次 System Audio 录制，系统将弹出标准的授权确认框；
3. 在系统设置中勾选允许，并根据系统提示重启 Tiginal 即可永久生效。
