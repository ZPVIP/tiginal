import { ipcRenderer } from 'electron';
import type {
  AudioRendererApi,
  AudioSessionEvent,
  CreateAudioSessionInput,
  PushPcmFrameInput,
  SpeechProviderInput,
  SpeechProviderTestInput,
} from '../shared/audio/types';
import type {
  DefaultEngineKind,
  MarketModel,
  ModelDownloadRequest,
  ModelMarketQuery,
  ModelsRendererApi,
  StartModelInput,
} from '../shared/models/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const audio: AudioRendererApi = {
  listSpeechProviders: () => ipcRenderer.invoke('audio:list-speech-providers'),
  getSpeechProviderCredential: (id: string) => (
    ipcRenderer.invoke('audio:get-speech-provider-credential', id)
  ),
  addSpeechProvider: (input: SpeechProviderInput) => ipcRenderer.invoke('audio:add-speech-provider', input),
  updateSpeechProvider: (input: SpeechProviderInput & { id: string }) => (
    ipcRenderer.invoke('audio:update-speech-provider', input)
  ),
  deleteSpeechProvider: (id: string) => ipcRenderer.invoke('audio:delete-speech-provider', id),
  testSpeechProvider: (input: SpeechProviderTestInput) => (
    ipcRenderer.invoke('audio:test-speech-provider', input)
  ),
  createSession: (input: CreateAudioSessionInput) => ipcRenderer.invoke('audio:create-session', input),
  pushPcmFrame: (input: PushPcmFrameInput) => ipcRenderer.send('audio:push-pcm-frame', input),
  finishSession: (sessionId: string) => ipcRenderer.invoke('audio:finish-session', sessionId),
  abortSession: (sessionId: string) => ipcRenderer.invoke('audio:abort-session', sessionId),
  deleteRecording: (recordingPath: string) => ipcRenderer.invoke('audio:delete-recording', recordingPath),
  getRecordingUrl: (recordingPath: string) => ipcRenderer.invoke('audio:get-recording-url', recordingPath),
  onSessionEvent: (listener: (event: AudioSessionEvent) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, event: AudioSessionEvent) => listener(event);
    ipcRenderer.on('audio:session-event', subscription);
    return () => ipcRenderer.removeListener('audio:session-event', subscription);
  },
};

const models: ModelsRendererApi = {
  listEngines: () => ipcRenderer.invoke('models:list-engines'),
  refreshEngines: () => ipcRenderer.invoke('models:refresh-engines'),
  listModelDirectories: () => ipcRenderer.invoke('models:list-directories'),
  addModelDirectory: (directoryPath: string) => ipcRenderer.invoke('models:add-directory', directoryPath),
  removeModelDirectory: (directoryPath: string) => ipcRenderer.invoke('models:remove-directory', directoryPath),
  getHomeDirectory: () => ipcRenderer.invoke('models:get-home-directory'),
  scanDownloadedModels: () => ipcRenderer.invoke('models:scan-downloaded'),
  listDownloadedModels: () => ipcRenderer.invoke('models:list-downloaded'),
  renameDownloadedModel: (id: string, name: string) => (
    ipcRenderer.invoke('models:rename-downloaded', { id, name })
  ),
  deleteDownloadedModel: (id: string) => ipcRenderer.invoke('models:delete-downloaded', id),
  searchModelMarket: (query: ModelMarketQuery) => ipcRenderer.invoke('models:search-market', query),
  getMarketModelDetails: (model: MarketModel) => ipcRenderer.invoke('models:get-market-details', model),
  setModelFavorite: (model: MarketModel, favorite: boolean) => (
    ipcRenderer.invoke('models:set-favorite', { model, favorite })
  ),
  listFavoriteModels: () => ipcRenderer.invoke('models:list-favorites'),
  startModelDownload: (request: ModelDownloadRequest) => ipcRenderer.invoke('models:start-download', request),
  cancelModelDownload: (id: string) => ipcRenderer.invoke('models:cancel-download', id),
  listModelDownloads: () => ipcRenderer.invoke('models:list-downloads'),
  listModelInstances: () => ipcRenderer.invoke('models:list-instances'),
  startModel: (input: StartModelInput) => ipcRenderer.invoke('models:start', input),
  restartModel: (id: string, input: StartModelInput) => (
    ipcRenderer.invoke('models:restart', { id, input })
  ),
  stopModel: (id: string) => ipcRenderer.invoke('models:stop', id),
  deleteModelService: (id: string) => ipcRenderer.invoke('models:delete-service', id),
  getModelLogs: (id: string) => ipcRenderer.invoke('models:logs', id),
  listDefaultEngineSelections: () => ipcRenderer.invoke('models:list-defaults'),
  setDefaultEngine: (kind: DefaultEngineKind, targetId: string | null) => (
    ipcRenderer.invoke('models:set-default', { kind, targetId })
  ),
};

window.electron = {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, func: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  audio,
  models,
};
