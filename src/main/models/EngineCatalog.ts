import type {
  EngineParameterDefinition,
  ModelCapability,
  ModelEngineCategory,
  ModelEngineId,
  SupportedArchitecture,
  SupportedPlatform,
} from '../../shared/models/types';

export interface EngineProbe {
  commandCandidates: readonly string[];
  args: readonly string[];
  versionPattern?: RegExp;
}

export interface EngineSpec {
  id: ModelEngineId;
  name: string;
  description: string;
  categories: readonly ModelEngineCategory[];
  platforms: readonly SupportedPlatform[];
  architectures?: readonly SupportedArchitecture[];
  capabilities: readonly ModelCapability[];
  probes: readonly EngineProbe[];
  installHints: Partial<Record<SupportedPlatform, readonly string[]>>;
  parameters: readonly EngineParameterDefinition[];
}

const HOST: EngineParameterDefinition = {
  kind: 'text', key: 'host', label: 'Host', defaultValue: '127.0.0.1', placeholder: '127.0.0.1',
};
const PORT: EngineParameterDefinition = {
  kind: 'integer', key: 'port', label: 'Port', defaultValue: 8080, min: 1, max: 65_535,
};
const THREADS: EngineParameterDefinition = {
  kind: 'integer', key: 'threads', label: 'Threads', defaultValue: 4, min: 1, max: 256,
};
const MAX_SESSION_DURATION: EngineParameterDefinition = {
  kind: 'optional-integer',
  key: 'maxSessionSeconds',
  label: 'Maximum session duration',
  defaultValue: null,
  min: 1,
  max: 86_400,
  placeholder: 'No limit',
};

export const ENGINE_SPECS: readonly EngineSpec[] = [
  {
    id: 'llama.cpp',
    name: 'llama.cpp',
    description: 'Runs GGUF text models and compatible R2T2 or T3PO builds.',
    categories: ['text-inference', 'speech'],
    platforms: ['darwin', 'linux', 'win32'],
    architectures: ['arm64', 'x64'],
    capabilities: ['text-generation', 'translation', 'speech-recognition', 'file-stream', 'microphone-stream'],
    probes: [{ commandCandidates: ['llama-server'], args: ['--version'] }],
    installHints: {
      darwin: ['brew install llama.cpp'],
      linux: ['Install llama.cpp from its official release or your distribution package manager.'],
      win32: ['Install a llama.cpp Windows release and add llama-server.exe to PATH.'],
    },
    parameters: [
      HOST,
      PORT,
      { kind: 'integer', key: 'contextSize', label: 'Context size', defaultValue: 4096, min: 128, max: 1_048_576 },
      THREADS,
      { kind: 'integer', key: 'gpuLayers', label: 'GPU layers', defaultValue: 0, min: 0, max: 999 },
      { kind: 'text', key: 'additionalSafeArgs', label: 'Additional safe arguments', defaultValue: '', placeholder: '--flash-attn on' },
    ],
  },
  {
    id: 'whisper.cpp',
    name: 'whisper.cpp',
    description: 'Runs Whisper-family speech recognition models in batch or streaming mode.',
    categories: ['speech'],
    platforms: ['darwin', 'linux', 'win32'],
    architectures: ['arm64', 'x64'],
    capabilities: ['speech-recognition', 'file-batch', 'file-stream'],
    probes: [
      { commandCandidates: ['whisper-server'], args: ['--help'] },
      { commandCandidates: ['whisper-cli', 'main'], args: ['--help'] },
    ],
    installHints: {
      darwin: ['brew install whisper-cpp'],
      linux: ['Build whisper.cpp and add whisper-server and whisper-cli to PATH.'],
      win32: ['Install a whisper.cpp Windows release and add its binaries to PATH.'],
    },
    parameters: [
      HOST,
      { ...PORT, defaultValue: 8081 },
      THREADS,
      { kind: 'text', key: 'language', label: 'Language', defaultValue: 'auto', placeholder: 'auto' },
      { kind: 'integer', key: 'stepMs', label: 'Step', defaultValue: 3000, min: 100, max: 60_000 },
      { kind: 'integer', key: 'windowMs', label: 'Window length', defaultValue: 10_000, min: 1000, max: 120_000 },
      { kind: 'number', key: 'vadThreshold', label: 'VAD threshold', defaultValue: 0.6, min: 0, max: 1, step: 0.05 },
      { kind: 'boolean', key: 'streaming', label: 'Streaming mode', defaultValue: false },
      MAX_SESSION_DURATION,
    ],
  },
  {
    id: 'vllm',
    name: 'vLLM',
    description: 'Runs safetensors text and supported realtime audio models on Linux.',
    categories: ['text-inference', 'speech'],
    platforms: ['linux'],
    architectures: ['x64', 'arm64'],
    capabilities: ['text-generation', 'translation', 'speech-recognition', 'file-batch'],
    probes: [{ commandCandidates: ['vllm'], args: ['--version'] }],
    installHints: {
      linux: ['Install vLLM using the official Python or container instructions.'],
    },
    parameters: [
      HOST,
      { ...PORT, defaultValue: 8082 },
      { kind: 'select', key: 'dtype', label: 'Dtype', defaultValue: 'auto', options: [
        { value: 'auto', label: 'Auto' },
        { value: 'float16', label: 'Float16' },
        { value: 'bfloat16', label: 'BFloat16' },
      ] },
      { kind: 'integer', key: 'maxModelLength', label: 'Maximum model length', defaultValue: 4096, min: 128, max: 1_048_576 },
      { kind: 'number', key: 'gpuMemoryUtilization', label: 'GPU memory utilization', defaultValue: 0.9, min: 0.1, max: 1, step: 0.05 },
      { kind: 'integer', key: 'tensorParallelSize', label: 'Tensor parallel size', defaultValue: 1, min: 1, max: 64 },
      { kind: 'text', key: 'servedModelName', label: 'Served model name', defaultValue: '', placeholder: 'Defaults to the service name' },
      MAX_SESSION_DURATION,
    ],
  },
  {
    id: 'mlx-lm',
    name: 'MLX LM',
    description: 'Runs MLX text models on Apple Silicon.',
    categories: ['text-inference'],
    platforms: ['darwin'],
    architectures: ['arm64'],
    capabilities: ['text-generation', 'translation'],
    probes: [{ commandCandidates: ['mlx_lm.server'], args: ['--help'] }],
    installHints: { darwin: ['python3 -m pip install -U mlx-lm'] },
    parameters: [
      HOST,
      { ...PORT, defaultValue: 8083 },
      { kind: 'integer', key: 'contextLength', label: 'Context length', defaultValue: 4096, min: 128, max: 262_144 },
      { kind: 'text', key: 'quantization', label: 'Quantization', defaultValue: '', placeholder: 'Model default' },
    ],
  },
  {
    id: 'mlx-audio',
    name: 'mlx-audio',
    description: 'Runs supported speech models on Apple Silicon. Realtime input depends on the selected model.',
    categories: ['speech'],
    platforms: ['darwin'],
    architectures: ['arm64'],
    capabilities: ['speech-recognition', 'speech-synthesis', 'file-batch', 'file-stream'],
    probes: [{ commandCandidates: ['python3'], args: ['-c', 'import mlx_audio; print(getattr(mlx_audio, "__version__", "available"))'] }],
    installHints: { darwin: ['python3 -m pip install -U mlx-audio'] },
    parameters: [
      HOST,
      { ...PORT, defaultValue: 8084 },
      { kind: 'boolean', key: 'realtimeModel', label: 'Realtime model', defaultValue: false },
      { kind: 'number', key: 'transcriptionDelay', label: 'Transcription delay', defaultValue: 0.5, min: 0, max: 30, step: 0.1 },
      { kind: 'text', key: 'vadModelPath', label: 'VAD model path', defaultValue: '', placeholder: 'Optional' },
      { kind: 'boolean', key: 'streamingSession', label: 'Streaming session', defaultValue: false },
      MAX_SESSION_DURATION,
    ],
  },
  {
    id: 'r2t2-runtime',
    name: 'Confucius4 R2T2 Runtime',
    description: 'Runs R2T2 through a compatible llama.cpp or vLLM backend.',
    categories: ['speech'],
    platforms: ['darwin', 'linux', 'win32'],
    architectures: ['arm64', 'x64'],
    capabilities: ['speech-recognition', 'file-stream', 'microphone-stream'],
    probes: [{ commandCandidates: ['r2t2-server'], args: ['--help'] }],
    installHints: {
      darwin: ['Install the Confucius4 R2T2 runtime and add r2t2-server to PATH.'],
      linux: ['Install the Confucius4 R2T2 runtime and add r2t2-server to PATH.'],
      win32: ['Install the supported R2T2 llama.cpp runtime or use vLLM through WSL2.'],
    },
    parameters: [
      { kind: 'select', key: 'backend', label: 'Backend', defaultValue: 'llama.cpp', options: [
        { value: 'llama.cpp', label: 'llama.cpp' },
        { value: 'vllm', label: 'vLLM' },
      ] },
      HOST,
      { ...PORT, defaultValue: 8085 },
      { kind: 'text', key: 'ggufPath', label: 'GGUF path', defaultValue: '', placeholder: 'Optional model override' },
      { kind: 'text', key: 'mmprojPath', label: 'MMProj path', defaultValue: '', placeholder: 'Optional' },
      { kind: 'text', key: 'vadModelPath', label: 'VAD model path', defaultValue: '', placeholder: 'Optional' },
      { kind: 'integer', key: 'gpuId', label: 'GPU ID', defaultValue: 0, min: 0, max: 64 },
      { kind: 'text', key: 'defaultLanguage', label: 'Default language', defaultValue: 'cn', placeholder: 'cn' },
      { kind: 'integer', key: 'chunkSize', label: 'Chunk size', defaultValue: 2560, min: 160, max: 160_000 },
      { kind: 'select', key: 'inferenceMode', label: 'Inference mode', defaultValue: 'stream_llama', options: [
        { value: 'stream_llama', label: 'stream_llama' },
        { value: 'stream_llama_hybrid', label: 'stream_llama_hybrid' },
        { value: 'onetime_llama', label: 'onetime_llama' },
        { value: 'stream_vllm', label: 'stream_vllm' },
        { value: 'onetime_vllm', label: 'onetime_vllm' },
      ] },
      MAX_SESSION_DURATION,
    ],
  },
];

export function engineSpec(id: ModelEngineId): EngineSpec {
  const spec = ENGINE_SPECS.find(candidate => candidate.id === id);
  if (!spec) throw new Error(`Unknown model engine: ${id}`);
  return spec;
}

export function engineRunsOnCurrentSystem(
  spec: EngineSpec,
  platform: SupportedPlatform,
  architecture: SupportedArchitecture,
): boolean {
  return spec.platforms.includes(platform)
    && (spec.architectures === undefined || spec.architectures.includes(architecture));
}
