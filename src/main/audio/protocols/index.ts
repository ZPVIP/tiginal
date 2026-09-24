import type { SpeechProviderProtocol } from '../../../shared/audio/types';
import { R2T2NativeAdapter } from './R2T2NativeAdapter';
import { R2T2RStreamAdapter } from './R2T2RStreamAdapter';
import { T3PONativeAdapter } from './T3PONativeAdapter';
import { T3PORStreamAdapter } from './T3PORStreamAdapter';
import type { SpeechProtocolAdapter } from './SpeechProtocolAdapter';

export function createSpeechProtocolAdapter(protocol: SpeechProviderProtocol): SpeechProtocolAdapter {
  switch (protocol) {
    case 'r2t2-rstream':
      return new R2T2RStreamAdapter();
    case 'r2t2-native':
      return new R2T2NativeAdapter();
    case 't3po-rstream':
      return new T3PORStreamAdapter();
    case 't3po-native':
      return new T3PONativeAdapter();
  }
}

export type { SpeechProtocolAdapter } from './SpeechProtocolAdapter';
export { T3PORStreamAdapter } from './T3PORStreamAdapter';
export { T3PONativeAdapter } from './T3PONativeAdapter';

