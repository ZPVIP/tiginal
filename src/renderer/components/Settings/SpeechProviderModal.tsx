import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import {
  SPEECH_PROVIDER_PROTOCOL_OPTIONS,
  type R2T2RecognitionMode,
  type SpeechAuthMode,
  type SpeechConnectionTestResult,
  type SpeechProvider,
  type SpeechProviderInput,
  type SpeechProviderProtocol,
  type TranslationLatencyMode,
} from '../../../shared/audio/types';
import { defaultSpeechProviderOptions } from '../../../shared/audio/r2t2';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';
import { InfoIcon } from '../Shared/InfoIcon';

interface SpeechProviderModalProps {
  provider?: SpeechProvider;
  initialCredential?: string;
  onClose(): void;
  onSaved(): void;
}

const inputClass = 'w-full rounded-lg border border-border bg-surface-light px-3 py-2 text-sm text-text-main outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60';
const labelClass = 'mb-1 block text-xs font-medium text-text-muted';

function initialInput(provider?: SpeechProvider): SpeechProviderInput {
  return {
    ...(provider ? { id: provider.id } : {}),
    name: provider?.name ?? '',
    protocol: provider?.protocol ?? 'r2t2-rstream',
    endpoint: provider?.endpoint ?? '',
    authMode: provider?.authMode ?? 'query-token',
    maxSessionSeconds: provider?.maxSessionSeconds ?? null,
    defaultLanguage: provider?.defaultLanguage ?? 'zh',
    options: provider?.options ?? defaultSpeechProviderOptions(),
  };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

// Loopback hosts default to ws:// and every other host to wss://, matching the endpoint rules in SpeechProviderStore.
function inferredScheme(host: string): 'ws' | 'wss' {
  try {
    return isLoopbackHost(new URL(`ws://${host}`).hostname) ? 'ws' : 'wss';
  } catch {
    return 'wss';
  }
}

function splitEndpoint(endpoint: string): { host: string; path: string } {
  try {
    const url = new URL(endpoint);
    const scheme = url.protocol.replace(/:$/, '');
    const host = scheme === inferredScheme(url.host) ? url.host : `${scheme}://${url.host}`;
    return { host, path: `${url.pathname}${url.search}` };
  } catch {
    return { host: '', path: '' };
  }
}

function joinEndpoint(host: string, path: string): string {
  const trimmedHost = host.trim().replace(/\/+$/, '');
  if (!trimmedHost) return '';
  const origin = /^wss?:\/\//i.test(trimmedHost)
    ? trimmedHost
    : `${inferredScheme(trimmedHost)}://${trimmedHost}`;
  const trimmedPath = path.trim();
  return `${origin}${trimmedPath && !trimmedPath.startsWith('/') ? '/' : ''}${trimmedPath}`;
}

function defaultPath(protocol: SpeechProviderProtocol): string | null {
  return SPEECH_PROVIDER_PROTOCOL_OPTIONS.find(option => option.protocol === protocol)?.defaultPath ?? null;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function speechProtocol(value: string): SpeechProviderProtocol {
  if (value === 'r2t2-native' || value === 't3po') return value;
  return 'r2t2-rstream';
}

function latencyMode(value: string): TranslationLatencyMode {
  return value === 'low' || value === 'high' ? value : 'native';
}

function splitList(value: string, separator: RegExp): string[] {
  return value.split(separator).map(item => item.trim()).filter(Boolean);
}

function recognitionMode(value: string): R2T2RecognitionMode {
  return value === 'fast' ? 'fast' : 'slow';
}

function speechAuthMode(value: string): SpeechAuthMode {
  if (value === 'none' || value === 'handshake-secret') return value;
  return 'query-token';
}

export function SpeechProviderModal({
  provider,
  initialCredential = '',
  onClose,
  onSaved,
}: SpeechProviderModalProps) {
  const [form, setForm] = useState<SpeechProviderInput>(() => initialInput(provider));
  const [host, setHost] = useState(() => splitEndpoint(form.endpoint).host);
  const [path, setPath] = useState(() => (provider ? splitEndpoint(provider.endpoint).path : defaultPath(form.protocol) ?? ''));
  const [credential, setCredential] = useState(initialCredential);
  const [credentialDirty, setCredentialDirty] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [bookedWords, setBookedWords] = useState(() => provider?.options.bookedWords.join(', ') ?? '');
  const [terminology, setTerminology] = useState(() => provider?.options.terminology.join('\n') ?? '');
  const isT3PO = form.protocol === 't3po';
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<SpeechConnectionTestResult | null>(null);

  const input = useMemo<SpeechProviderInput>(() => ({
    ...form,
    endpoint: joinEndpoint(host, path),
    ...(credential.trim() ? { credential: credential.trim() } : {}),
    options: {
      ...form.options,
      bookedWords: splitList(bookedWords, /,/),
      terminology: splitList(terminology, /\n/),
    },
  }), [bookedWords, credential, form, host, path, terminology]);

  const update = <Key extends keyof SpeechProviderInput>(
    key: Key,
    value: SpeechProviderInput[Key],
  ) => setForm(current => ({ ...current, [key]: value }));

  const updateOption = (
    key: 'smooth' | 'mode' | 'systemPrompt' | 'latencyMode' | 'chunkSizeMs',
    value: boolean | string | number | null,
  ) => setForm(current => ({
    ...current,
    options: { ...current.options, [key]: value },
  }));

  const testConnection = async () => {
    const audio = window.electron?.audio;
    if (!audio) return;
    setBusy('test');
    setResult(null);
    try {
      setResult(await audio.testSpeechProvider(input));
    } catch (error) {
      setResult({ success: false, error: messageFromError(error) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const audio = window.electron?.audio;
    if (!audio) return;
    setBusy('save');
    setResult(null);
    try {
      const saveInput = credentialDirty
        ? input
        : { ...input, credential: undefined };
      if (provider) {
        await audio.updateSpeechProvider({ ...saveInput, id: provider.id });
      } else {
        await audio.addSpeechProvider(saveInput);
      }
      window.dispatchEvent(new Event('speech-providers-updated'));
      onSaved();
    } catch (error) {
      setResult({ success: false, error: messageFromError(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={provider ? 'Edit Streaming Provider' : 'Add Streaming Provider'}
      width="max-w-2xl"
    >
      <form onSubmit={save} className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>Name</span>
            <input
              required
              className={inputClass}
              value={form.name}
              onChange={event => update('name', event.target.value)}
            />
          </label>
          <label>
            <span className={labelClass}>Protocol</span>
            <select
              className={inputClass}
              value={form.protocol}
              onChange={event => {
                const protocol = speechProtocol(event.target.value);
                const protocolPath = defaultPath(protocol);
                if (protocolPath) setPath(protocolPath);
                setForm(current => ({
                  ...current,
                  protocol,
                  authMode: protocol === 'r2t2-native' ? 'handshake-secret' : 'query-token',
                }));
              }}
            >
              {SPEECH_PROVIDER_PROTOCOL_OPTIONS.map(option => (
                <option key={option.protocol} value={option.protocol}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={`${labelClass} flex items-center gap-1`}>
              Host:port
              <InfoIcon title="Loopback hosts connect with ws:// and other hosts with wss://. Prefix the host with ws:// or wss:// to choose the scheme explicitly." />
            </span>
            <input
              required
              className={inputClass}
              value={host}
              placeholder={isT3PO ? '127.0.0.1:8273' : '127.0.0.1:8272'}
              onChange={event => setHost(event.target.value)}
            />
          </label>
          <label>
            <span className={labelClass}>Endpoint</span>
            <input
              className={inputClass}
              value={path}
              placeholder={defaultPath(form.protocol) ?? ''}
              onChange={event => setPath(event.target.value)}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>Authentication</span>
            <select
              className={inputClass}
              value={form.authMode}
              onChange={event => update('authMode', speechAuthMode(event.target.value))}
            >
              {form.protocol !== 'r2t2-native' && <option value="query-token">Query token</option>}
              {form.protocol === 'r2t2-native' && <option value="handshake-secret">Handshake secret</option>}
              <option value="none">None</option>
            </select>
          </label>
          <label>
            <span className={labelClass}>Token or secret</span>
            <div className="relative">
              <input
                className={`${inputClass} pr-10`}
                type={showCredential ? 'text' : 'password'}
                autoComplete="new-password"
                value={credential}
                placeholder={provider?.hasCredential ? 'Leave blank to keep the current value' : 'Required by the provider'}
                onChange={event => {
                  setCredential(event.target.value);
                  setCredentialDirty(true);
                }}
              />
              <button
                type="button"
                title={showCredential ? 'Hide token or secret' : 'Show token or secret'}
                aria-label={showCredential ? 'Hide token or secret' : 'Show token or secret'}
                onClick={() => setShowCredential(current => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-main"
              >
                {showCredential ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>
        </div>

        {isT3PO ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={`${labelClass} flex items-center gap-1`}>
                  Latency mode
                  <InfoIcon title={'Controls when T3PO commits a translation.\nLow: commits earlier with less context, so translations appear sooner.\nNative: uses the model\'s own decision.\nHigh: waits for more source text, which adds delay but gives the model more context.\nThe audio workspace can override this for each session.'} />
                </span>
                <select
                  className={inputClass}
                  value={form.options?.latencyMode ?? 'native'}
                  onChange={event => updateOption('latencyMode', latencyMode(event.target.value))}
                >
                  <option value="low">Low</option>
                  <option value="native">Native</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                <span className={`${labelClass} flex items-center gap-1`}>
                  Chunk size (ms)
                  <InfoIcon title="Audio streaming chunk duration in milliseconds (e.g. 160). When set, Tiginal generates chunk timeline, speaker diarization, and SRT subtitles. Leave empty to disable." />
                </span>
                <input
                  className={inputClass}
                  type="number"
                  min="20"
                  step="20"
                  value={form.options?.chunkSizeMs ?? ''}
                  placeholder="e.g. 160 (empty to disable)"
                  onChange={event => updateOption(
                    'chunkSizeMs',
                    event.target.value ? Number.parseInt(event.target.value, 10) : null,
                  )}
                />
              </label>
            </div>

            <label className="block">
              <span className={`${labelClass} flex items-center gap-1`}>
                Terminology
                <InfoIcon title={'Fixed translations for T3PO, one per line as source=target, for example large language model=LLM.\nA line without = keeps the term unchanged.\nT3PO applies an entry only when its source text appears in the current input. Terms entered in the audio workspace are added for each session.'} />
              </span>
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                value={terminology}
                placeholder={'large language model=LLM\nTiginal'}
                onChange={event => setTerminology(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={labelClass}>Default language</span>
                <input
                  required
                  className={inputClass}
                  value={form.defaultLanguage}
                  placeholder="zh"
                  onChange={event => update('defaultLanguage', event.target.value)}
                />
              </label>
              <label>
                <span className={labelClass}>Maximum session duration in seconds</span>
                <input
                  className={inputClass}
                  type="number"
                  min="1"
                  step="1"
                  value={form.maxSessionSeconds ?? ''}
                  placeholder="No limit"
                  onChange={event => update(
                    'maxSessionSeconds',
                    event.target.value ? Number.parseInt(event.target.value, 10) : null,
                  )}
                />
              </label>
            </div>

            <label className="block">
              <span className={`${labelClass} flex items-center gap-1`}>
                Booked words
                <InfoIcon title="Names and technical terms the recognizer should favor, such as product or person names. Separate entries with commas. Terms entered in the audio workspace are added to this list for each session." />
              </span>
              <input
                className={inputClass}
                value={bookedWords}
                placeholder="Tiginal, R2T2"
                onChange={event => setBookedWords(event.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={`${labelClass} flex items-center gap-1`}>
                  Recognition mode
                  <InfoIcon title="Slow holds back the last few tokens until they stabilize. Fast commits all text once it ends with punctuation, which lowers latency but can reduce accuracy." />
                </span>
                <select
                  className={inputClass}
                  value={form.options?.mode ?? 'slow'}
                  onChange={event => updateOption('mode', recognitionMode(event.target.value))}
                >
                  <option value="slow">Slow</option>
                  <option value="fast">Fast</option>
                </select>
              </label>
              <label>
                <span className={`${labelClass} flex items-center gap-1`}>
                  Chunk size (ms)
                  <InfoIcon title="R2T2 audio streaming chunk duration in milliseconds (typically 160). When set, Tiginal generates chunk timeline, speaker diarization, and SRT subtitles. Leave empty to disable." />
                </span>
                <input
                  className={inputClass}
                  type="number"
                  min="20"
                  step="20"
                  value={form.options?.chunkSizeMs ?? ''}
                  placeholder="e.g. 160 (empty to disable)"
                  onChange={event => updateOption(
                    'chunkSizeMs',
                    event.target.value ? Number.parseInt(event.target.value, 10) : null,
                  )}
                />
              </label>
            </div>

            <div className="flex items-center gap-2 py-1 text-xs text-text-muted">
              <Toggle
                size="small"
                label="Transcript smoothing"
                checked={form.options?.smooth ?? false}
                onChange={value => updateOption('smooth', value)}
              />
              Smooth
              <InfoIcon title="Adds the instruction 'Smooth the text' to the recognition prompt so the model returns smoother wording. This is a model prompt, not text post-processing." />
            </div>

            <label className="block">
              <span className={labelClass}>Recognition prompt</span>
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                value={form.options?.systemPrompt ?? ''}
                placeholder="Optional recognition context"
                onChange={event => updateOption('systemPrompt', event.target.value)}
              />
            </label>
          </>
        )}

        {result && (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${result.success ? 'bg-accent-success/10 text-accent-success' : 'bg-accent-danger/10 text-accent-danger'}`}>
            {result.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            <span>{result.success ? 'Connection succeeded.' : result.error || 'Connection failed.'}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            disabled={busy !== null}
            onClick={testConnection}
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-main hover:bg-surface-light disabled:opacity-50"
          >
            {busy === 'test' && <Loader2 size={15} className="animate-spin" />}
            Test Connection
          </button>
          <button
            type="submit"
            disabled={busy !== null}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'save' && <Loader2 size={15} className="animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
