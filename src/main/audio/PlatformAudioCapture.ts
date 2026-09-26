import type { DesktopCapturerSource, Session } from 'electron';
import type {
  AudioInputCapabilities,
  MacMediaAccessStatus,
  SystemAudioPermissionInfo,
} from '../../shared/audio/types';

export const MAC_SYSTEM_AUDIO_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

type DisplayMediaSession = Pick<Session, 'setDisplayMediaRequestHandler'>;

export interface PlatformAudioCaptureDependencies {
  platform: NodeJS.Platform;
  displayMediaSession: DisplayMediaSession;
  getScreenSources(): Promise<DesktopCapturerSource[]>;
}

export interface MacAudioCaptureRuntime {
  isPackaged: boolean;
  electronMajor: number;
}

export function getMacAudioCaptureEnabledFeatures(): string[] {
  return [
    'MacLoopbackAudioForScreenShare',
    'MacSckSystemAudioLoopbackOverride',
  ];
}

export function getMacAudioCaptureDisabledFeatures(runtime: MacAudioCaptureRuntime): string[] {
  return !runtime.isPackaged && runtime.electronMajor < 45
    ? ['MacCatapLoopbackAudioForScreenShare']
    : [];
}

export function getAudioInputCapabilities(platform: NodeJS.Platform): AudioInputCapabilities {
  if (platform === 'darwin' || platform === 'win32') {
    return { sources: ['microphone', 'system', 'mixed', 'file'] };
  }
  return { sources: ['microphone', 'file'] };
}

export function getSystemAudioPermissionInfo(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  screenStatus: MacMediaAccessStatus,
): SystemAudioPermissionInfo {
  if (platform !== 'darwin') return { kind: 'unsupported' };
  return {
    kind: 'macos',
    screenStatus,
    permissionOwner: isPackaged ? 'application' : 'launcher',
  };
}

export function configurePlatformAudioCapture({
  platform,
  displayMediaSession,
  getScreenSources,
}: PlatformAudioCaptureDependencies): void {
  if (platform === 'darwin' || platform === 'win32') {
    displayMediaSession.setDisplayMediaRequestHandler((request, callback) => {
      grantScreenWithLoopback(request, callback, getScreenSources);
    });
    return;
  }

  displayMediaSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function grantScreenWithLoopback(
  request: Electron.DisplayMediaRequestHandlerHandlerRequest,
  callback: (streams: Electron.Streams) => void,
  getScreenSources: () => Promise<DesktopCapturerSource[]>,
): void {
  if (!request.userGesture || !request.audioRequested || !request.videoRequested) {
    callback({});
    return;
  }

  void getScreenSources()
    .then(sources => {
      const screen = sources[0];
      callback(screen ? { video: screen, audio: 'loopback' } : {});
    })
    .catch(() => callback({}));
}
