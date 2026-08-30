const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

const electronPath = require('electron');

const macOsNoisePatterns = [
  /CoreText note: Client requested name "\.[^"]+", it will get .+ rather than the intended font\. All system UI font access should be through proper APIs/,
  /CoreText note: Set a breakpoint on CTFontLogSystemFontNameRequest to debug\.$/,
  /error messaging the mach port for IMKCFRunLoopWakeUpReliable$/,
  /TSM AdjustCapsLockLEDForKeyTransitionHandling - \\?_ISSetPhysicalKeyboardCapsLockLED Inhibit$/,
];

function shouldSuppressStderrLine(line, platform = process.platform) {
  return platform === 'darwin' && macOsNoisePatterns.some((pattern) => pattern.test(line));
}

function startElectron() {
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

  child.on('exit', (code, signal) => {
    if (signal) {
      process.stderr.write(`Electron exited after receiving ${signal}\n`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  startElectron();
}

module.exports = { shouldSuppressStderrLine };
