# Stop CoreText font warnings from flooding Electron logs on macOS

An Electron renderer can flood the terminal with CoreText warnings when macOS resolves a private system UI font during font fallback. I ran into this in a terminal application that renders Chinese text through xterm.js. The application stayed responsive. The warning repeated often enough to bury every useful log line.

This post documents the affected environment, the checks that narrowed down the cause, and the startup wrapper that stopped the output while preserving real errors.

## Reproduction environment

The warning appeared in this environment:

| Component | Version or value |
| --- | --- |
| macOS | 26.5, build 25F71 |
| Architecture | Apple Silicon, `arm64` |
| Electron | 28.3.3 |
| Chromium bundled with Electron | 120.0.6099.291 |
| Node.js bundled with Electron | 18.18.2 |
| Host Node.js used by npm scripts | 25.2.1 |
| npm | 11.6.2 |
| xterm.js | 5.5.0 |
| Shell | `/bin/zsh` |
| Terminal font | `"MesloLGS NF", monospace` |
| Start command | `npm start` |

Electron 28 has reached end of support. The same class of warning has also been reported on other Electron versions, so an Electron upgrade alone does not guarantee that the output disappears.

## Problem

The renderer printed this line repeatedly:

```text
2026-08-29 11:54:29.388 Electron Helper (Renderer)[33523:42765496] CoreText note: Client requested name ".PingFangUIDisplaySC-Regular", it will get TimesNewRomanPSMT rather than the intended font. All system UI font access should be through proper APIs such as CTFontCreateUIFontForLanguage() or +[NSFont systemFontOfSize:].
```

CoreText sometimes followed it with another line:

```text
CoreText note: Set a breakpoint on CTFontLogSystemFontNameRequest to debug.
```

The application did not request `.PingFangUIDisplaySC-Regular` anywhere in its source. A full search covered CSS, TypeScript, generated renderer assets, Electron flags, and environment variables.

The saved terminal font was MesloLGS NF, which lacked complete Chinese glyph coverage in this setup. Chromium therefore asked macOS for a fallback font. macOS can select a private PingFang UI face for that fallback. The fallback explains how the private font name enters the renderer. A reliable minimal reproduction remains unavailable because a small xterm.js page with the same font and Chinese text did not trigger the warning on every run.

## Why the usual environment variable did not solve it

Many reports recommend this environment variable:

```bash
OS_ACTIVITY_MODE=disable electron .
```

Chromium uses the same setting for sandboxed child processes on macOS. Its child process launcher adds `OS_ACTIVITY_MODE=disable` when Chromium INFO logging is off because macOS system logging has a measurable performance cost.

The affected project had this script in `package.json`:

```json
{
	"scripts": {
		"start": "npm run build && ELECTRON_ENABLE_LOGGING=true electron ."
	}
}
```

Electron documents `ELECTRON_ENABLE_LOGGING` as the environment-variable form of `--enable-logging`. It enables Chromium logging and sends internal output to stderr. Chromium checks whether INFO logging is active before it adds its macOS logging suppression setting.

Shell scope caused another failed attempt:

```bash
OS_ACTIVITY_MODE=disable npm run build && electron .
```

In that command, `OS_ACTIVITY_MODE` belongs only to `npm run build`. The `electron .` process starts after the scoped environment has ended.

This form gives the variable to Electron:

```bash
npm run build && OS_ACTIVITY_MODE=disable electron .
```

That command still depends on CoreText honoring the activity setting. On the affected system, a small number of native framework messages continued to reach stderr. A narrow stderr filter was needed as a final guard.

## Solution

The fix has two parts. The launcher removes Electron logging variables and sets `OS_ACTIVITY_MODE` before Electron starts. It then filters only the known CoreText private-font messages on macOS.

Change the start script in `package.json`:

```json
{
	"scripts": {
		"start": "npm run build && node scripts/start-electron.cjs"
	}
}
```

Create `scripts/start-electron.cjs`:

```js
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

const electronPath = require('electron');

const macOsCoreTextNoisePatterns = [
	/CoreText note: Client requested name "\.[^"]+", it will get .+ rather than the intended font\. All system UI font access should be through proper APIs/,
	/CoreText note: Set a breakpoint on CTFontLogSystemFontNameRequest to debug\.$/,
];

function shouldSuppressStderrLine(line) {
	return process.platform === 'darwin' &&
		macOsCoreTextNoisePatterns.some((pattern) => pattern.test(line));
}

const env = {
	...process.env,
	OS_ACTIVITY_MODE: 'disable',
};

delete env.ELECTRON_ENABLE_LOGGING;
delete env.ELECTRON_LOG_FILE;

const child = spawn(electronPath, ['.'], {
	cwd: path.resolve(__dirname, '..'),
	env,
	stdio: ['inherit', 'inherit', 'pipe'],
});

const stderr = readline.createInterface({ input: child.stderr });
stderr.on('line', (line) => {
	if (!shouldSuppressStderrLine(line)) {
		process.stderr.write(`${line}\n`);
	}
});

child.on('error', (error) => {
	process.stderr.write(`Failed to start Electron: ${error.message}\n`);
	process.exitCode = 1;
});

child.on('exit', (code) => {
	process.exitCode = code ?? 1;
});
```

The wrapper keeps stdin and stdout attached to the terminal. It reads stderr one line at a time. On macOS, it drops only the two CoreText messages shown above. Every other Electron, Chromium, and application error still reaches the terminal.

The wrapper also deletes `ELECTRON_ENABLE_LOGGING` from the child environment. This matters when a shell profile, IDE, or parent process exports the variable outside `package.json`.

## Verify the result

Start the application through the wrapper:

```bash
npm start
```

Exercise the path that produced the warning. In my case, that meant opening an xterm.js terminal, rendering Chinese text, changing focus, and typing with a macOS input method enabled.

Confirm both results:

- The CoreText private-font messages no longer appear.
- Normal application errors and explicit `console.error` calls still appear.

The second check matters. Redirecting all stderr to `/dev/null` clears the terminal and removes crash diagnostics, GPU errors, native module failures, and other logs that are worth keeping.

## Font changes are optional

Replacing `system-ui`, `-apple-system`, or a Latin-only terminal font can reduce the number of fallback requests. It can also change the application's typography and terminal metrics. I kept the selected terminal font because the startup wrapper removed the log flood without changing text layout.

If the application visibly renders Chinese text as Times New Roman, treat that as a font-selection bug. The stderr filter only controls console output. It does not change the font chosen by CoreText.

## References

- [Electron issue #33317: CoreText system UI font warnings](https://github.com/electron/electron/issues/33317)
- [Electron environment variables](https://www.electronjs.org/docs/latest/api/environment-variables#electron_enable_logging)
- [Electron command-line switch documentation for `--enable-logging`](https://www.electronjs.org/docs/latest/api/command-line-switches#--enable-loggingfile)
- [Chromium macOS child process launcher](https://chromium.googlesource.com/experimental/chromium/src/%2B/HEAD/content/browser/child_process_launcher_helper_mac.cc)
- [Electron 28.3.3 release details](https://releases.electronjs.org/release/v28.3.3)
