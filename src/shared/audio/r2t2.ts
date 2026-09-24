import type { R2T2ProviderOptions, SpeechProviderProtocol } from './types';

export const R2T2_SAMPLE_RATE = 16_000;
export const R2T2_CHANNELS = 1;
export const R2T2_FRAME_DURATION_MS = 160;
export const R2T2_FRAME_SAMPLES = 2_560;
export const R2T2_NATIVE_TAIL_SILENCE_MS = 500;
export const R2T2_RSTREAM_EOS = 'YOUDAO_ASR_EOS';
export const R2T2_NATIVE_EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS';

export interface SpeechProtocolState {
  committedText: string;
  partialText: string;
}

export interface SpeechSessionOptions {
  requestId: string;
  language: string;
  credential: string | null;
  options: R2T2ProviderOptions;
}

export function defaultR2T2ProviderOptions(): R2T2ProviderOptions {
  return {
    bookedWords: [],
    useVad: false,
    smooth: false,
    mode: 'slow',
    systemPrompt: '',
  };
}

const RSTREAM_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  arabic: 'ar',
  ar: 'ar',
  cantonese: 'yue',
  chinese: 'cn',
  cn: 'cn',
  cs: 'cs',
  czech: 'cs',
  da: 'da',
  danish: 'da',
  de: 'de',
  dutch: 'nl',
  el: 'el',
  en: 'en',
  english: 'en',
  enus: 'en',
  enzh: 'en',
  es: 'sp',
  fa: 'fa',
  fil: 'fil',
  filipino: 'fil',
  fi: 'fi',
  finnish: 'fi',
  fr: 'fr',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hi: 'hi',
  hindi: 'hi',
  hu: 'hu',
  hungarian: 'hu',
  id: 'id',
  indonesian: 'id',
  it: 'it',
  italian: 'it',
  ja: 'jp',
  japanese: 'jp',
  jp: 'jp',
  ko: 'ko',
  korean: 'ko',
  macedonian: 'mk',
  malay: 'ms',
  mandarin: 'cn',
  mk: 'mk',
  ms: 'ms',
  nl: 'nl',
  persian: 'fa',
  pl: 'pl',
  polish: 'pl',
  portuguese: 'pt',
  pt: 'pt',
  ro: 'ro',
  romanian: 'ro',
  ru: 'ru',
  russian: 'ru',
  sp: 'sp',
  spanish: 'sp',
  sv: 'sv',
  swedish: 'sv',
  th: 'th',
  thai: 'th',
  tr: 'tr',
  turkish: 'tr',
  vi: 'vi',
  vietnamese: 'vi',
  yue: 'yue',
  zh: 'cn',
};

export function mapR2T2RStreamLanguage(language: string): string {
  return RSTREAM_LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? 'cn';
}

export function formatR2T2BookedWords(words: readonly string[]): string {
  const uniqueWords: string[] = [];
  const seen = new Set<string>();
  let characterCount = 0;
  for (const candidate of words) {
    const word = candidate.trim();
    const normalized = word.toLowerCase();
    if (!word || seen.has(normalized) || characterCount + word.length > 50) continue;
    seen.add(normalized);
    uniqueWords.push(word);
    characterCount += word.length;
  }
  return uniqueWords.length > 0 ? `Technical words: ${uniqueWords.join(', ')}` : '';
}

export function eosForProtocol(protocol: SpeechProviderProtocol): string {
  return protocol === 'r2t2-native' ? R2T2_NATIVE_EOS : R2T2_RSTREAM_EOS;
}

export function tailSilenceSamples(protocol: SpeechProviderProtocol): number {
  if (protocol !== 'r2t2-native') return 0;
  return Math.round(R2T2_SAMPLE_RATE * (R2T2_NATIVE_TAIL_SILENCE_MS / 1_000));
}
