const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ENGINE_SPECS,
  engineRunsOnCurrentSystem,
} = require('../dist/main/main/models/EngineCatalog.js');
const {
  buildLaunchPlan,
  formatLaunchCommand,
  ModelRuntimeSupervisor,
  normalizeEngineParameters,
} = require('../dist/main/main/models/ModelRuntimeSupervisor.js');
const { ModelLibraryService } = require('../dist/main/main/models/ModelLibraryService.js');
const { scanModelDirectories } = require('../dist/main/main/models/ModelScanner.js');

function engine(id) {
  const result = ENGINE_SPECS.find(candidate => candidate.id === id);
  assert.ok(result);
  return result;
}

function memoryProfileDatabase() {
  const profiles = new Map();
  return {
    prepare(sql) {
      if (sql.includes('SELECT id, engine_id')) {
        return { all: () => [...profiles.values()] };
      }
      if (sql.includes('INSERT INTO model_run_profiles')) {
        return {
          run(id, engineId, modelPath, displayName, parametersJson) {
            profiles.set(id, {
              id,
              engine_id: engineId,
              model_path: modelPath,
              display_name: displayName,
              parameters_json: parametersJson,
            });
            return { changes: 1 };
          },
        };
      }
      if (sql.includes('DELETE FROM model_run_profiles')) {
        return {
          run(id) {
            const deleted = profiles.delete(id);
            return { changes: deleted ? 1 : 0 };
          },
        };
      }
      throw new Error(`Unexpected SQL in test database: ${sql}`);
    },
  };
}

function memoryModelLibraryDatabase() {
  const aliases = new Map();
  return {
    aliases,
    prepare(sql) {
      if (sql.includes('UPDATE model_downloads')) return { run: () => ({ changes: 0 }) };
      if (sql.includes('FROM model_downloads')) return { all: () => [] };
      if (sql.includes('FROM model_favorites')) return { all: () => [] };
      if (sql.includes('SELECT storage_path, display_name FROM model_aliases')) {
        return {
          all: () => [...aliases].map(([storagePath, displayName]) => ({
            storage_path: storagePath,
            display_name: displayName,
          })),
        };
      }
      if (sql.includes('INSERT INTO model_aliases')) {
        return {
          run(storagePath, displayName) {
            aliases.set(storagePath, displayName);
            return { changes: 1 };
          },
        };
      }
      throw new Error(`Unexpected SQL in model library test database: ${sql}`);
    },
  };
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('engine catalog filters platform-specific runtimes before rendering', () => {
  assert.equal(engineRunsOnCurrentSystem(engine('llama.cpp'), 'darwin', 'arm64'), true);
  assert.equal(engineRunsOnCurrentSystem(engine('vllm'), 'darwin', 'arm64'), false);
  assert.equal(engineRunsOnCurrentSystem(engine('vllm'), 'linux', 'x64'), true);
  assert.equal(engineRunsOnCurrentSystem(engine('mlx-lm'), 'linux', 'arm64'), false);
  assert.equal(engineRunsOnCurrentSystem(engine('mlx-lm'), 'darwin', 'arm64'), true);
});

test('llama launch plans use argument arrays and reject unapproved flags', () => {
  const input = {
    engineId: 'llama.cpp',
    modelPath: '/models/demo.gguf',
    displayName: 'Demo service',
    parameters: {},
  };
  const parameters = normalizeEngineParameters('llama.cpp', {
    host: '127.0.0.1',
    port: 8080,
    contextSize: 8192,
    threads: 8,
    gpuLayers: 40,
    additionalSafeArgs: '--flash-attn on --mlock',
  });
  const plan = buildLaunchPlan('llama.cpp', '/usr/local/bin/llama-server', input, parameters);
  assert.equal(plan.command, '/usr/local/bin/llama-server');
  assert.deepEqual(plan.args.slice(0, 4), ['--model', '/models/demo.gguf', '--alias', 'Demo service']);
  assert.equal(plan.args.includes('--flash-attn'), true);
  assert.equal(plan.args.includes('--mlock'), true);
  assert.equal(plan.endpoint, 'http://127.0.0.1:8080/v1');
  assert.equal(
    formatLaunchCommand({
      command: 'C:\\Program Files\\llama-server.exe',
      args: ['--model', 'C:\\My Models\\demo.gguf'],
      endpoint: null,
    }, 'win32'),
    '"C:\\Program Files\\llama-server.exe" --model "C:\\My Models\\demo.gguf"',
  );

  const unsafe = normalizeEngineParameters('llama.cpp', {
    ...parameters,
    additionalSafeArgs: '--dangerous-command value',
  });
  assert.throws(
    () => buildLaunchPlan('llama.cpp', '/usr/local/bin/llama-server', input, unsafe),
    /not allowed/,
  );
});

test('model scanner recognizes managed and Hugging Face cache layouts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-model-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const managed = path.join(root, 'managed');
  const localModel = path.join(managed, 'demo-gguf');
  fs.mkdirSync(localModel, { recursive: true });
  fs.writeFileSync(path.join(localModel, 'demo.gguf'), Buffer.alloc(32));

  const cache = path.join(root, 'hub');
  const r2t2 = path.join(
    cache,
    'models--netease-youdao--Confucius4-R2T2',
    'snapshots',
    'revision-1',
  );
  fs.mkdirSync(r2t2, { recursive: true });
  fs.writeFileSync(path.join(r2t2, 'model.safetensors'), Buffer.alloc(64));

  const models = scanModelDirectories([
    { path: managed, kind: 'managed' },
    { path: cache, kind: 'huggingface-cache' },
  ]);
  assert.equal(models.length, 2);
  const local = models.find(model => model.path === path.join(localModel, 'demo.gguf'));
  assert.equal(local.format, 'gguf');
  assert.equal(local.defaultName, 'demo-gguf');
  assert.equal(local.storagePath, localModel);
  assert.deepEqual(local.compatibleEngineIds, ['llama.cpp']);

  const speech = models.find(model => model.repoId === 'netease-youdao/Confucius4-R2T2');
  assert.equal(speech.revision, 'revision-1');
  assert.equal(speech.capabilities.includes('microphone-stream'), true);
  assert.deepEqual(speech.compatibleEngineIds, ['r2t2-runtime', 'vllm']);
});

test('downloaded model names persist across rescans without changing the model path', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-model-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelRoot = path.join(root, 'default-title');
  fs.mkdirSync(modelRoot, { recursive: true });
  fs.writeFileSync(path.join(modelRoot, 'model.gguf'), Buffer.alloc(16));

  const db = memoryModelLibraryDatabase();
  const library = new ModelLibraryService(db);
  library.listDirectories = () => [{
    path: root,
    kind: 'managed',
    enabled: true,
    removable: false,
  }];

  const initial = await library.scanDownloadedModels();
  assert.equal(initial[0].name, 'default-title');
  const renamed = library.renameDownloadedModel(initial[0].id, 'My local model');
  assert.equal(renamed[0].name, 'My local model');
  assert.equal(renamed[0].path, initial[0].path);
  const rescanned = await library.scanDownloadedModels();
  assert.equal(rescanned[0].name, 'My local model');
  assert.equal(rescanned[0].defaultName, 'default-title');
});

test('runtime supervisor starts, logs, and stops a managed process', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tiginal-model-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'fake-llama-server');
  const modelPath = path.join(root, 'demo.gguf');
  fs.writeFileSync(executable, [
    '#!/usr/bin/env node',
    "console.log('fake model server ready');",
    "process.on('SIGINT', () => process.exit(0));",
    'setInterval(() => undefined, 1000);',
  ].join('\n'));
  fs.chmodSync(executable, 0o755);
  fs.writeFileSync(modelPath, Buffer.alloc(8));

  const db = memoryProfileDatabase();
  const supervisor = new ModelRuntimeSupervisor(db, async () => [{
    id: 'llama.cpp',
    name: 'llama.cpp',
    description: '',
    categories: ['text-inference'],
    capabilities: ['text-generation'],
    installHints: [],
    parameters: engine('llama.cpp').parameters,
    status: { kind: 'available', executablePath: executable, version: 'test', detail: null },
    runningInstances: 0,
  }]);
  t.after(async () => {
    await supervisor.disposeAll();
  });

  const instance = await supervisor.start({
    engineId: 'llama.cpp',
    modelPath,
    displayName: 'Test service',
    parameters: normalizeEngineParameters('llama.cpp', {}),
  });
  await waitUntil(() => supervisor.logs(instance.id).some(line => line.includes('ready')));
  assert.equal(supervisor.list().find(item => item.id === instance.id).status, 'running');
  assert.match(instance.commandLine, /--model/);
  assert.match(instance.commandLine, /Test service/);
  assert.equal(supervisor.logs(instance.id).some(line => line.includes('ready')), true);

  const stopped = await supervisor.stop(instance.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(supervisor.hasActiveProcesses(), false);
  assert.equal(supervisor.logs(instance.id).some(line => line.includes('ready')), true);
  supervisor.delete(instance.id);
  assert.equal(supervisor.list().length, 0);
});
