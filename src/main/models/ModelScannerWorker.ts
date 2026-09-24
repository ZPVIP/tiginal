import { parentPort } from 'worker_threads';
import { scanModelDirectories, type ScanDirectoryInput } from './ModelScanner';

function parseDirectories(value: unknown): ScanDirectoryInput[] {
  if (!Array.isArray(value)) throw new Error('Model scan input must be an array');
  return value.map(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Model scan directory must be an object');
    }
    const directoryPath = Reflect.get(item, 'path');
    const kind = Reflect.get(item, 'kind');
    if (typeof directoryPath !== 'string' || !directoryPath) {
      throw new Error('Model scan directory path is required');
    }
    if (kind !== 'managed' && kind !== 'user' && kind !== 'huggingface-cache') {
      throw new Error('Model scan directory kind is invalid');
    }
    return { path: directoryPath, kind };
  });
}

parentPort?.on('message', (value: unknown) => {
  try {
    parentPort?.postMessage({ ok: true, models: scanModelDirectories(parseDirectories(value)) });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
