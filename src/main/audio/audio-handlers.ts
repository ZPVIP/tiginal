import { ipcMain, type IpcMainEvent } from 'electron';
import { getDatabase } from '../../services/database/database';
import { getCrypto } from '../../services/ssh/CryptoService';
import type {
  AudioSessionEvent,
  CreateAudioSessionInput,
  SpeechProviderTestInput,
} from '../../shared/audio/types';
import { R2T2_FRAME_SAMPLES } from '../../shared/audio/r2t2';
import { toRecordingUrl } from './AudioMediaProtocol';
import { AudioService } from './AudioService';
import { AudioSessionRepository } from './AudioSessionRepository';
import { testR2T2Connection } from './R2T2Client';
import { parseSpeechProviderInput, SpeechProviderStore } from './SpeechProviderStore';

let audioService: AudioService | null = null;

function providerStore(): SpeechProviderStore {
  return new SpeechProviderStore(getDatabase().getDb(), getCrypto());
}

export function getAudioService(): AudioService {
  if (!audioService) {
    const db = getDatabase().getDb();
    audioService = new AudioService(providerStore(), new AudioSessionRepository(db));
  }
  return audioService;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} ID is required`);
  return value;
}

function parseCreateSessionInput(value: unknown): CreateAudioSessionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Audio session input must be an object');
  }
  const providerId = Reflect.get(value, 'providerId');
  const language = Reflect.get(value, 'language');
  const bookedWords = Reflect.get(value, 'bookedWords');
  const source = parseAudioSource(Reflect.get(value, 'source'));
  if (typeof providerId !== 'string' || !providerId.trim()) {
    throw new Error('Speech provider ID is required');
  }
  return {
    providerId,
    ...(typeof language === 'string' ? { language } : {}),
    ...(Array.isArray(bookedWords)
      ? { bookedWords: bookedWords.filter((word): word is string => typeof word === 'string') }
      : {}),
    ...(source ? { source } : {}),
  };
}

function parseAudioSource(value: unknown): CreateAudioSessionInput['source'] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Audio source must be an object');
  }
  const kind = Reflect.get(value, 'kind');
  if (kind === 'microphone') return { kind };
  if (kind === 'file') {
    const name = Reflect.get(value, 'name');
    if (typeof name !== 'string' || !name.trim()) throw new Error('Audio file name is required');
    return { kind, name: name.trim() };
  }
  throw new Error('Audio source is invalid');
}

function parsePcmFrame(value: unknown): Int16Array {
  const maxFrameBytes = R2T2_FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT;
  if (value instanceof ArrayBuffer) {
    if (value.byteLength === 0 || value.byteLength > maxFrameBytes || value.byteLength % 2 !== 0) {
      throw new Error('PCM frame length is invalid');
    }
    return new Int16Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength === 0 || value.byteLength > maxFrameBytes || value.byteLength % 2 !== 0) {
      throw new Error('PCM frame length is invalid');
    }
    const copy = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return new Int16Array(copy);
  }
  throw new Error('PCM frame must be an ArrayBuffer');
}

export function setupAudioHandlers(): void {
  ipcMain.handle('audio:list-speech-providers', () => providerStore().list());
  ipcMain.handle('audio:get-speech-provider-credential', (_event, value: unknown) => {
    try {
      return providerStore().require(requireId(value, 'Speech provider')).credential;
    } catch {
      return null;
    }
  });
  ipcMain.handle('audio:add-speech-provider', (_event, value: unknown) => (
    providerStore().add(parseSpeechProviderInput(value))
  ));
  ipcMain.handle('audio:update-speech-provider', (_event, value: unknown) => {
    const input = parseSpeechProviderInput(value, true);
    if (!input.id) throw new Error('Speech provider ID is required');
    return providerStore().update({ ...input, id: input.id });
  });
  ipcMain.handle('audio:delete-speech-provider', (_event, value: unknown) => {
    providerStore().delete(requireId(value, 'Speech provider'));
  });
  ipcMain.handle('audio:test-speech-provider', async (_event, value: unknown) => {
    try {
      const input: SpeechProviderTestInput = parseSpeechProviderInput(value);
      const resolved = providerStore().resolveForTest(input);
      await testR2T2Connection(resolved.provider, resolved.credential);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('audio:create-session', async (event, value: unknown) => {
    const emit = (audioEvent: AudioSessionEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('audio:session-event', audioEvent);
    };
    return getAudioService().createSession(parseCreateSessionInput(value), emit);
  });
  ipcMain.on('audio:push-pcm-frame', (_event: IpcMainEvent, value: unknown) => {
    try {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
      const sessionId = requireId(Reflect.get(value, 'sessionId'), 'Audio session');
      const frame = parsePcmFrame(Reflect.get(value, 'frame'));
      getAudioService().pushPcmFrame(sessionId, frame);
    } catch {
      // AudioService emits a session failure for operational errors. Invalid IPC is ignored.
    }
  });
  ipcMain.handle('audio:finish-session', (_event, value: unknown) => (
    getAudioService().finishSession(requireId(value, 'Audio session'))
  ));
  ipcMain.handle('audio:abort-session', (_event, value: unknown) => (
    getAudioService().abortSession(requireId(value, 'Audio session'))
  ));
  ipcMain.handle('audio:delete-recording', (_event, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Recording path is required');
    getAudioService().deleteRecording(value);
  });
  ipcMain.handle('audio:get-recording-url', (_event, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Recording path is required');
    return toRecordingUrl(value);
  });
}
