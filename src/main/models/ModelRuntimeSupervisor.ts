import * as crypto from 'crypto';
import { spawn, type ChildProcessByStdio } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import type Database from 'better-sqlite3';
import type {
  EngineParameterDefinition,
  EngineParameters,
  EngineParameterValue,
  ModelEngineId,
  ModelEngineView,
  ModelInstance,
  StartModelInput,
} from '../../shared/models/types';
import { engineSpec } from './EngineCatalog';

const MAX_LOG_LINES = 2_000;
const GRACEFUL_TIMEOUT_MS = 5_000;
const TERMINATE_TIMEOUT_MS = 2_000;

interface RunProfileRow {
  id: string;
  engine_id: string;
  model_path: string;
  display_name: string;
  parameters_json: string;
  command_line: string | null;
}

function parseRunProfileRow(value: unknown): RunProfileRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.engine_id !== 'string'
    || typeof value.model_path !== 'string' || typeof value.display_name !== 'string'
    || typeof value.parameters_json !== 'string') return null;
  return {
    id: value.id,
    engine_id: value.engine_id,
    model_path: value.model_path,
    display_name: value.display_name,
    parameters_json: value.parameters_json,
    command_line: typeof value.command_line === 'string' ? value.command_line : null,
  };
}

interface ActiveProcess {
  child: ActiveChildProcess;
  instance: ModelInstance;
  logs: string[];
  stopping: boolean;
}

type ActiveChildProcess = ChildProcessByStdio<null, Readable, Readable>;

interface LaunchPlan {
  command: string;
  args: string[];
  endpoint: string | null;
}

function quoteCommandToken(token: string, platform: NodeJS.Platform): string {
  if (/^[a-zA-Z0-9_./\\:@%+=,-]+$/.test(token)) return token;
  if (platform === 'win32') return `"${token.replace(/"/g, '\\"')}"`;
  return `'${token.replace(/'/g, `'"'"'`)}'`;
}

export function formatLaunchCommand(
  plan: LaunchPlan,
  platform: NodeJS.Platform = process.platform,
): string {
  return [plan.command, ...plan.args].map(token => quoteCommandToken(token, platform)).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function engineParameterValue(value: unknown): EngineParameterValue | undefined {
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseParametersJson(value: string): EngineParameters {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return {};
    const parameters: EngineParameters = {};
    for (const [key, candidate] of Object.entries(parsed)) {
      const parameter = engineParameterValue(candidate);
      if (parameter !== undefined) parameters[key] = parameter;
    }
    return parameters;
  } catch {
    return {};
  }
}

function stringParameter(parameters: EngineParameters, key: string): string {
  const value = parameters[key];
  return typeof value === 'string' ? value : '';
}

function numberParameter(parameters: EngineParameters, key: string): number {
  const value = parameters[key];
  if (typeof value !== 'number') throw new Error(`${key} must be a number`);
  return value;
}

function booleanParameter(parameters: EngineParameters, key: string): boolean {
  return parameters[key] === true;
}

function validateParameter(
  definition: EngineParameterDefinition,
  value: EngineParameterValue | undefined,
): EngineParameterValue {
  const candidate = value === undefined ? definition.defaultValue : value;
  if (definition.kind === 'text') {
    if (typeof candidate !== 'string') throw new Error(`${definition.label} must be text`);
    return candidate.trim();
  }
  if (definition.kind === 'boolean') {
    if (typeof candidate !== 'boolean') throw new Error(`${definition.label} must be true or false`);
    return candidate;
  }
  if (definition.kind === 'select') {
    if (typeof candidate !== 'string'
      || !definition.options.some(option => option.value === candidate)) {
      throw new Error(`${definition.label} has an unsupported value`);
    }
    return candidate;
  }
  if (definition.kind === 'optional-integer' && candidate === null) return null;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw new Error(`${definition.label} must be a number`);
  }
  if ((definition.kind === 'integer' || definition.kind === 'optional-integer')
    && !Number.isInteger(candidate)) {
    throw new Error(`${definition.label} must be an integer`);
  }
  if (candidate < definition.min || candidate > definition.max) {
    throw new Error(`${definition.label} must be between ${definition.min} and ${definition.max}`);
  }
  return candidate;
}

export function normalizeEngineParameters(
  engineId: ModelEngineId,
  input: EngineParameters,
): EngineParameters {
  const normalized: EngineParameters = {};
  for (const definition of engineSpec(engineId).parameters) {
    normalized[definition.key] = validateParameter(definition, input[definition.key]);
  }
  return normalized;
}

function additionalLlamaArguments(value: string): string[] {
  if (!value.trim()) return [];
  const tokens = value.trim().split(/\s+/);
  const booleanFlags = new Set(['--mlock', '--no-mmap', '--numa']);
  const valuedFlags = new Set(['--flash-attn', '--batch-size', '--ubatch-size', '--cache-type-k', '--cache-type-v']);
  const result: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (booleanFlags.has(token)) {
      result.push(token);
      continue;
    }
    if (!valuedFlags.has(token)) throw new Error(`Additional argument is not allowed: ${token}`);
    const argument = tokens[index + 1];
    if (!argument || !/^[a-zA-Z0-9._:+/-]+$/.test(argument)) {
      throw new Error(`Additional argument requires a safe value: ${token}`);
    }
    result.push(token, argument);
    index += 1;
  }
  return result;
}

export function buildLaunchPlan(
  engineId: ModelEngineId,
  executablePath: string,
  input: StartModelInput,
  parameters: EngineParameters,
): LaunchPlan {
  const host = stringParameter(parameters, 'host');
  const portValue = parameters.port;
  const port = typeof portValue === 'number' ? portValue : null;
  const endpoint = host && port ? `http://${host}:${port}/v1` : null;
  if (engineId === 'llama.cpp') {
    return {
      command: executablePath,
      args: [
        '--model', input.modelPath,
        '--alias', input.displayName,
        '--host', host,
        '--port', String(numberParameter(parameters, 'port')),
        '--ctx-size', String(numberParameter(parameters, 'contextSize')),
        '--threads', String(numberParameter(parameters, 'threads')),
        '--n-gpu-layers', String(numberParameter(parameters, 'gpuLayers')),
        ...additionalLlamaArguments(stringParameter(parameters, 'additionalSafeArgs')),
      ],
      endpoint,
    };
  }
  if (engineId === 'whisper.cpp') {
    return {
      command: executablePath,
      args: [
        '--model', input.modelPath,
        '--host', host,
        '--port', String(numberParameter(parameters, 'port')),
        '--threads', String(numberParameter(parameters, 'threads')),
        '--language', stringParameter(parameters, 'language'),
      ],
      endpoint,
    };
  }
  if (engineId === 'vllm') {
    const servedModelName = stringParameter(parameters, 'servedModelName') || input.displayName;
    return {
      command: executablePath,
      args: [
        'serve', input.modelPath,
        '--host', host,
        '--port', String(numberParameter(parameters, 'port')),
        '--dtype', stringParameter(parameters, 'dtype'),
        '--max-model-len', String(numberParameter(parameters, 'maxModelLength')),
        '--gpu-memory-utilization', String(numberParameter(parameters, 'gpuMemoryUtilization')),
        '--tensor-parallel-size', String(numberParameter(parameters, 'tensorParallelSize')),
        '--served-model-name', servedModelName,
      ],
      endpoint,
    };
  }
  if (engineId === 'mlx-lm') {
    return {
      command: executablePath,
      args: [
        '--model', input.modelPath,
        '--host', host,
        '--port', String(numberParameter(parameters, 'port')),
      ],
      endpoint,
    };
  }
  if (engineId === 'mlx-audio') {
    return {
      command: executablePath,
      args: [
        '-m', 'mlx_audio.server',
        '--model', input.modelPath,
        '--host', host,
        '--port', String(numberParameter(parameters, 'port')),
        ...(booleanParameter(parameters, 'realtimeModel') ? ['--realtime'] : []),
      ],
      endpoint,
    };
  }
  const backend = stringParameter(parameters, 'backend');
  return {
    command: executablePath,
    args: [
      '--backend', backend,
      '--model', input.modelPath,
      '--host', host,
      '--port', String(numberParameter(parameters, 'port')),
      '--language', stringParameter(parameters, 'defaultLanguage'),
      '--chunk-size', String(numberParameter(parameters, 'chunkSize')),
      '--mode', stringParameter(parameters, 'inferenceMode'),
      '--gpu-id', String(numberParameter(parameters, 'gpuId')),
      ...(stringParameter(parameters, 'ggufPath') ? ['--gguf', stringParameter(parameters, 'ggufPath')] : []),
      ...(stringParameter(parameters, 'mmprojPath') ? ['--mmproj', stringParameter(parameters, 'mmprojPath')] : []),
      ...(stringParameter(parameters, 'vadModelPath') ? ['--vad-model', stringParameter(parameters, 'vadModelPath')] : []),
    ],
    endpoint,
  };
}

function waitForExit(child: ActiveChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener('close', closed);
      resolve(false);
    }, timeoutMs);
    const closed = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('close', closed);
  });
}

function signalProcess(child: ActiveChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may already have exited.
  }
}

function forceKillWindowsProcessTree(pid: number): Promise<void> {
  return new Promise(resolve => {
    const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    taskkill.once('error', () => resolve());
    taskkill.once('close', () => resolve());
  });
}

function engineId(value: string): ModelEngineId | null {
  if (value === 'llama.cpp' || value === 'whisper.cpp' || value === 'vllm'
    || value === 'mlx-lm' || value === 'mlx-audio' || value === 'r2t2-runtime') return value;
  return null;
}

export class ModelRuntimeSupervisor {
  private readonly active = new Map<string, ActiveProcess>();
  private readonly runtimeState = new Map<string, ModelInstance>();
  private readonly runtimeLogs = new Map<string, string[]>();
  private disposing = false;

  constructor(
    private readonly db: Database.Database,
    private readonly listEngines: () => Promise<ModelEngineView[]>,
  ) {}

  runningCount(id: ModelEngineId): number {
    return [...this.active.values()].filter(processInfo => (
      processInfo.instance.engineId === id
      && processInfo.instance.status !== 'stopped'
      && processInfo.instance.status !== 'error'
    )).length;
  }

  hasActiveProcesses(): boolean {
    return this.active.size > 0;
  }

  list(): ModelInstance[] {
    const rawRows: unknown[] = this.db.prepare(`
      SELECT id, engine_id, model_path, display_name, parameters_json, command_line
      FROM model_run_profiles ORDER BY updated_at DESC
    `).all();
    const rows = rawRows.flatMap(value => {
      const row = parseRunProfileRow(value);
      return row ? [row] : [];
    });
    return rows.flatMap(row => {
      const parsedEngineId = engineId(row.engine_id);
      if (!parsedEngineId) return [];
      const current = this.runtimeState.get(row.id);
      if (current) return [current];
      const stopped: ModelInstance = {
        id: row.id,
        engineId: parsedEngineId,
        modelPath: row.model_path,
        displayName: row.display_name,
        parameters: parseParametersJson(row.parameters_json),
        commandLine: row.command_line,
        status: 'stopped',
        pid: null,
        endpoint: null,
        startedAt: null,
        exitCode: null,
        error: null,
      };
      return [stopped];
    });
  }

  async start(input: StartModelInput): Promise<ModelInstance> {
    const id = crypto.randomUUID();
    return this.launch(id, input, true);
  }

  async restart(id: string, input: StartModelInput): Promise<ModelInstance> {
    if (this.active.has(id)) await this.stop(id);
    return this.launch(id, input, false);
  }

  async stop(id: string): Promise<ModelInstance> {
    const processInfo = this.active.get(id);
    if (!processInfo) return this.requireInstance(id);
    processInfo.stopping = true;
    processInfo.instance = { ...processInfo.instance, status: 'stopping' };
    this.runtimeState.set(id, processInfo.instance);
    signalProcess(processInfo.child, 'SIGINT');
    if (!await waitForExit(processInfo.child, GRACEFUL_TIMEOUT_MS)) {
      signalProcess(processInfo.child, 'SIGTERM');
      if (!await waitForExit(processInfo.child, TERMINATE_TIMEOUT_MS)) {
        if (process.platform === 'win32' && processInfo.child.pid) {
          await forceKillWindowsProcessTree(processInfo.child.pid);
        } else {
          signalProcess(processInfo.child, 'SIGKILL');
        }
        await waitForExit(processInfo.child, TERMINATE_TIMEOUT_MS);
      }
    }
    const stopped: ModelInstance = {
      ...processInfo.instance,
      status: 'stopped',
      pid: null,
      endpoint: null,
    };
    this.active.delete(id);
    this.runtimeState.set(id, stopped);
    return stopped;
  }

  delete(id: string): void {
    if (this.active.has(id)) throw new Error('Stop the local model service before deleting it');
    this.requireInstance(id);
    this.db.prepare(`DELETE FROM model_run_profiles WHERE id = ?`).run(id);
    this.runtimeState.delete(id);
    this.runtimeLogs.delete(id);
  }

  logs(id: string): string[] {
    return this.runtimeLogs.get(id) ?? [];
  }

  async disposeAll(): Promise<void> {
    this.disposing = true;
    await Promise.all([...this.active.keys()].map(id => this.stop(id)));
  }

  disposeAllNow(): void {
    this.disposing = true;
    for (const processInfo of this.active.values()) {
      if (process.platform === 'win32' && processInfo.child.pid) {
        void forceKillWindowsProcessTree(processInfo.child.pid);
      } else {
        signalProcess(processInfo.child, 'SIGKILL');
      }
    }
    this.active.clear();
  }

  private reserveAvailablePort(parameters: EngineParameters): EngineParameters {
    const requestedPort = parameters.port;
    if (typeof requestedPort !== 'number') return parameters;
    const usedPorts = new Set(
      [...this.active.values()]
        .map(processInfo => processInfo.instance.parameters.port)
        .filter((value): value is number => typeof value === 'number'),
    );
    let port = requestedPort;
    while (usedPorts.has(port) && port < 65_535) port += 1;
    if (usedPorts.has(port)) throw new Error('No available model service port was found');
    return port === requestedPort ? parameters : { ...parameters, port };
  }

  private async launch(id: string, input: StartModelInput, insert: boolean): Promise<ModelInstance> {
    if (this.disposing) throw new Error('Tiginal is shutting down and cannot start another model');
    if (!fs.existsSync(input.modelPath)) throw new Error('Selected model path does not exist');
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Local service name is required');
    const engines = await this.listEngines();
    const engine = engines.find(candidate => candidate.id === input.engineId);
    if (!engine) throw new Error('Selected model engine is not supported on this system');
    if (engine.status.kind !== 'available') {
      throw new Error(engine.status.kind === 'missing' ? engine.status.reason : 'Selected engine is unavailable');
    }
    const parameters = this.reserveAvailablePort(
      normalizeEngineParameters(input.engineId, input.parameters),
    );
    const plan = buildLaunchPlan(input.engineId, engine.status.executablePath, input, parameters);
    const commandLine = formatLaunchCommand(plan);
    const now = Date.now();
    if (insert) {
      this.db.prepare(`
        INSERT INTO model_run_profiles (
          id, engine_id, model_path, display_name, parameters_json, created_at, updated_at, command_line
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.engineId, input.modelPath, displayName, JSON.stringify(parameters), now, now, commandLine);
    } else {
      const result = this.db.prepare(`
        UPDATE model_run_profiles
        SET engine_id = ?, model_path = ?, display_name = ?, parameters_json = ?, updated_at = ?, command_line = ?
        WHERE id = ?
      `).run(input.engineId, input.modelPath, displayName, JSON.stringify(parameters), now, commandLine, id);
      if (result.changes === 0) throw new Error('Model run profile not found');
    }

    const instance: ModelInstance = {
      id,
      engineId: input.engineId,
      modelPath: input.modelPath,
      displayName,
      parameters,
      commandLine,
      status: 'starting',
      pid: null,
      endpoint: plan.endpoint,
      startedAt: now,
      exitCode: null,
      error: null,
    };
    const child = spawn(plan.command, plan.args, {
      cwd: fs.statSync(input.modelPath).isDirectory() ? input.modelPath : path.dirname(input.modelPath),
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs: string[] = [];
    const processInfo: ActiveProcess = { child, instance, logs, stopping: false };
    this.active.set(id, processInfo);
    this.runtimeState.set(id, instance);
    this.runtimeLogs.set(id, logs);
    const appendLogs = (chunk: Buffer) => {
      processInfo.logs.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
      if (processInfo.logs.length > MAX_LOG_LINES) {
        processInfo.logs.splice(0, processInfo.logs.length - MAX_LOG_LINES);
      }
    };
    child.stdout.on('data', appendLogs);
    child.stderr.on('data', appendLogs);
    child.once('spawn', () => {
      processInfo.instance = { ...processInfo.instance, status: 'running', pid: child.pid ?? null };
      this.runtimeState.set(id, processInfo.instance);
    });
    child.once('error', error => {
      processInfo.logs.push(error.message);
      processInfo.instance = {
        ...processInfo.instance,
        status: 'error',
        pid: null,
        error: error.message,
      };
      this.runtimeState.set(id, processInfo.instance);
      this.active.delete(id);
    });
    child.once('close', code => {
      const stoppedNormally = processInfo.stopping || code === 0;
      processInfo.instance = {
        ...processInfo.instance,
        status: stoppedNormally ? 'stopped' : 'error',
        pid: null,
        endpoint: null,
        exitCode: code,
        error: stoppedNormally ? null : `Model process exited with code ${code ?? 'unknown'}`,
      };
      this.runtimeState.set(id, processInfo.instance);
      this.active.delete(id);
    });
    return instance;
  }

  private requireInstance(id: string): ModelInstance {
    const instance = this.list().find(candidate => candidate.id === id);
    if (!instance) throw new Error('Model run profile not found');
    return instance;
  }
}
