import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {
  EngineProbeStatus,
  ModelCapability,
  ModelEngineView,
  SupportedArchitecture,
  SupportedPlatform,
  SystemToolView,
} from '../../shared/models/types';
import {
  ENGINE_SPECS,
  engineRunsOnCurrentSystem,
  type EngineProbe,
  type EngineSpec,
} from './EngineCatalog';

const PROBE_TIMEOUT_MS = 3_000;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1_024;

interface ProbeResult {
  executablePath: string;
  output: string;
}

interface ProbeAttempt {
  result: ProbeResult | null;
  failure: { executablePath: string; error: string } | null;
}

function currentPlatform(): SupportedPlatform | null {
  if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') {
    return process.platform;
  }
  return null;
}

function currentArchitecture(): SupportedArchitecture | null {
  if (process.arch === 'arm64' || process.arch === 'x64') return process.arch;
  return null;
}

function executableExtensions(): readonly string[] {
  if (process.platform !== 'win32') return [''];
  const configured = process.env.PATHEXT?.split(path.delimiter).filter(Boolean);
  return configured && configured.length > 0 ? configured : ['.EXE', '.CMD', '.BAT'];
}

function executableSearchDirectories(): string[] {
  const configured = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
  const common = process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']
    : process.platform === 'linux'
      ? ['/usr/local/bin', '/usr/bin']
      : [];
  return [...new Set([...configured, ...common])];
}

function findExecutable(command: string): string | null {
  if (path.isAbsolute(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  for (const directory of executableSearchDirectories()) {
    for (const extension of executableExtensions()) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue through PATH candidates.
      }
    }
  }
  return null;
}

async function runProbe(executablePath: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const append = (chunk: Buffer) => {
      if (Buffer.byteLength(output) >= MAX_PROBE_OUTPUT_BYTES) return;
      output += chunk.toString('utf8').slice(0, MAX_PROBE_OUTPUT_BYTES - Buffer.byteLength(output));
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('Probe timed out'));
    }, PROBE_TIMEOUT_MS);
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Probe exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

async function executeProbe(probe: EngineProbe): Promise<ProbeAttempt> {
  let failure: ProbeAttempt['failure'] = null;
  for (const command of probe.commandCandidates) {
    const executablePath = findExecutable(command);
    if (!executablePath) continue;
    try {
      return {
        result: { executablePath, output: await runProbe(executablePath, probe.args) },
        failure: null,
      };
    } catch (error) {
      failure = {
        executablePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { result: null, failure };
}

function firstOutputLine(output: string): string | null {
  return output.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
}

async function detectEngine(spec: EngineSpec): Promise<EngineProbeStatus> {
  let failure: ProbeAttempt['failure'] = null;
  for (const probe of spec.probes) {
    const attempt = await executeProbe(probe);
    if (!attempt.result) {
      failure = attempt.failure ?? failure;
      continue;
    }
    const result = attempt.result;
    const firstLine = firstOutputLine(result.output);
    const versionMatch = probe.versionPattern?.exec(result.output);
    return {
      kind: 'available',
      executablePath: result.executablePath,
      version: versionMatch?.[1] ?? firstLine,
      detail: null,
    };
  }
  if (failure) {
    if (failure.error === 'Probe timed out') {
      return {
        kind: 'available',
        executablePath: failure.executablePath,
        version: null,
        detail: 'The executable was found, but its version probe did not exit within the timeout.',
      };
    }
    return {
      kind: 'misconfigured',
      reason: failure.error,
      executablePath: failure.executablePath,
    };
  }
  return { kind: 'missing', reason: 'No compatible executable was found on PATH.' };
}

async function detectSystemTool(
  id: SystemToolView['id'],
  description: string,
  installHints: readonly string[],
): Promise<SystemToolView> {
  const executablePath = findExecutable(id);
  if (!executablePath) {
    return {
      id,
      name: id,
      description,
      installHints,
      status: { kind: 'missing', reason: `${id} was not found on PATH.` },
    };
  }
  try {
    const versionOutput = await runProbe(executablePath, ['-version']);
    let detail: string | null = null;
    if (id === 'ffmpeg') {
      const encoders = await runProbe(executablePath, ['-hide_banner', '-encoders']);
      const available = [
        encoders.includes('libmp3lame') ? 'MP3' : null,
        encoders.includes(' aac ') ? 'AAC' : null,
        encoders.includes('libopus') ? 'Opus' : null,
      ].filter((value): value is string => value !== null);
      detail = available.length > 0 ? `Encoders: ${available.join(', ')}` : 'No common audio encoders detected.';
    }
    return {
      id,
      name: id,
      description,
      installHints,
      status: {
        kind: 'available',
        executablePath,
        version: firstOutputLine(versionOutput),
        detail,
      },
    };
  } catch (error) {
    return {
      id,
      name: id,
      description,
      installHints,
      status: {
        kind: 'misconfigured',
        reason: error instanceof Error ? error.message : String(error),
        executablePath,
      },
    };
  }
}

export class EngineDetector {
  private cached: { engines: ModelEngineView[]; systemTools: SystemToolView[] } | null = null;

  constructor(private readonly runningCount: (engineId: ModelEngineView['id']) => number) {}

  async list(forceRefresh = false): Promise<{ engines: ModelEngineView[]; systemTools: SystemToolView[] }> {
    if (this.cached && !forceRefresh) {
      return {
        engines: this.cached.engines.map(engine => ({
          ...engine,
          runningInstances: this.runningCount(engine.id),
        })),
        systemTools: this.cached.systemTools,
      };
    }

    const platform = currentPlatform();
    const architecture = currentArchitecture();
    const compatibleSpecs = platform && architecture
      ? ENGINE_SPECS.filter(spec => engineRunsOnCurrentSystem(spec, platform, architecture))
      : [];
    const engines = await Promise.all(compatibleSpecs.map(async spec => {
      const status = await detectEngine(spec);
      const capabilities: readonly ModelCapability[] = spec.id === 'whisper.cpp' && findExecutable('whisper-stream')
        ? [...spec.capabilities, 'microphone-stream']
        : spec.capabilities;
      return {
        id: spec.id,
        name: spec.name,
        description: spec.description,
        categories: spec.categories,
        capabilities,
        installHints: platform ? spec.installHints[platform] ?? [] : [],
        parameters: spec.parameters,
        status,
        runningInstances: this.runningCount(spec.id),
      } satisfies ModelEngineView;
    }));
    const ffmpegHints = platform === 'darwin'
      ? ['brew install ffmpeg']
      : platform === 'win32'
        ? ['winget install Gyan.FFmpeg', 'Install FFmpeg from ffmpeg.org and add it to PATH.']
        : ['Install ffmpeg using your distribution package manager.'];
    const systemTools = await Promise.all([
      detectSystemTool('ffmpeg', 'Audio conversion, MP3 export, duration analysis, and waveform generation.', ffmpegHints),
      detectSystemTool('ffprobe', 'Reliable media metadata and duration inspection.', ffmpegHints),
    ]);
    this.cached = { engines, systemTools };
    return this.list(false);
  }
}
