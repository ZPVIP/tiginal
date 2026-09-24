import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import type {
  SpeechAuthMode,
  SpeechConnectionTestResult,
  SpeechProvider,
  SpeechProviderInput,
  SpeechProviderProtocol,
} from '../../../shared/audio/types';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';
import { InfoTooltip } from '../Shared/InfoTooltip';

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
    endpoint: provider?.endpoint ?? 'wss://',
    authMode: provider?.authMode ?? 'query-token',
    maxSessionSeconds: provider?.maxSessionSeconds ?? null,
    defaultLanguage: provider?.defaultLanguage ?? 'zh',
    options: provider?.options ?? {
      bookedWords: [],
      useVad: false,
      smooth: false,
      mode: 'slow',
      systemPrompt: '',
    },
    enabled: provider?.enabled ?? true,
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function speechProtocol(value: string): SpeechProviderProtocol {
  if (value === 'r2t2-native') return 'r2t2-native';
  if (value === 't3po-rstream') return 't3po-rstream';
  if (value === 't3po-native') return 't3po-native';
  return 'r2t2-rstream';
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
  const [credential, setCredential] = useState(initialCredential);
  const [credentialDirty, setCredentialDirty] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [bookedWords, setBookedWords] = useState(() => provider?.options.bookedWords.join(', ') ?? '');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<SpeechConnectionTestResult | null>(null);

  const input = useMemo<SpeechProviderInput>(() => ({
    ...form,
    ...(credential.trim() ? { credential: credential.trim() } : {}),
    options: {
      ...form.options,
      bookedWords: bookedWords.split(',').map(word => word.trim()).filter(Boolean),
    },
  }), [bookedWords, credential, form]);

  const update = <Key extends keyof SpeechProviderInput>(
    key: Key,
    value: SpeechProviderInput[Key],
  ) => setForm(current => ({ ...current, [key]: value }));

  const updateOption = (
    key: 'useVad' | 'smooth' | 'mode' | 'systemPrompt',
    value: boolean | string,
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
      title={provider ? 'Edit Speech Provider' : 'Add Speech Provider'}
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
                setForm(current => ({
                  ...current,
                  protocol,
                  authMode: (protocol === 'r2t2-native' || protocol === 't3po-native') ? 'handshake-secret' : 'query-token',
                }));
              }}
            >
              <option value="r2t2-rstream">R2T2 rstream</option>
              <option value="r2t2-native">R2T2 native</option>
              <option value="t3po-rstream">T3PO rstream</option>
              <option value="t3po-native">T3PO native</option>
            </select>
          </label>
        </div>

        <label>
          <span className={labelClass}>WebSocket endpoint</span>
          <input
            required
            className={inputClass}
            value={form.endpoint}
            placeholder={form.protocol.startsWith('t3po') ? 'wss://t3po.youdao.com/stream' : 'wss://example.com/asr'}
            onChange={event => update('endpoint', event.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>Authentication</span>
            <select
              className={inputClass}
              value={form.authMode}
              onChange={event => update('authMode', speechAuthMode(event.target.value))}
            >
              {(form.protocol === 'r2t2-rstream' || form.protocol === 't3po-rstream') && <option value="query-token">Query token</option>}
              {(form.protocol === 'r2t2-native' || form.protocol === 't3po-native') && <option value="handshake-secret">Handshake secret</option>}
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

        <label>
          <span className={labelClass}>Booked words</span>
          <input
            className={inputClass}
            value={bookedWords}
            placeholder="Tiginal, R2T2"
            onChange={event => setBookedWords(event.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>Recognition mode</span>
            <input
              className={inputClass}
              value={form.options?.mode ?? ''}
              onChange={event => updateOption('mode', event.target.value)}
            />
          </label>
          <div className="flex items-end gap-5 pb-2">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Toggle
                size="small"
                label="Voice activity detection"
                checked={form.options?.useVad ?? false}
                onChange={value => updateOption('useVad', value)}
              />
              VAD
              <InfoTooltip label="Voice Activity Detection identifies speech and silence so the recognizer can segment audio and avoid processing long silent regions." />
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Toggle
                size="small"
                label="Transcript smoothing"
                checked={form.options?.smooth ?? false}
                onChange={value => updateOption('smooth', value)}
              />
              Smooth
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Toggle
                size="small"
                label="Provider enabled"
                checked={form.enabled ?? true}
                onChange={value => update('enabled', value)}
              />
              Enabled
            </div>
          </div>
        </div>

        <label>
          <span className={labelClass}>Recognition prompt</span>
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={form.options?.systemPrompt ?? ''}
            placeholder="Optional recognition context"
            onChange={event => updateOption('systemPrompt', event.target.value)}
          />
        </label>

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
