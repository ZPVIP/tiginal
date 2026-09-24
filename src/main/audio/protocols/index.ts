import type { SpeechProviderProtocol } from '../../../shared/audio/types';
import { R2T2NativeAdapter } from './R2T2NativeAdapter';
import { R2T2RStreamAdapter } from './R2T2RStreamAdapter';
import type { SpeechProtocolAdapter } from './SpeechProtocolAdapter';

export function createSpeechProtocolAdapter(protocol: SpeechProviderProtocol): SpeechProtocolAdapter {
  switch (protocol) {
    case 'r2t2-rstream':
      return new R2T2RStreamAdapter();
    case 'r2t2-native':
      return new R2T2NativeAdapter();
  }
}

export type { SpeechProtocolAdapter } from './SpeechProtocolAdapter';
