import React, { useEffect, useRef, useState } from 'react';

type ContextWindowSource = 'manual' | 'props' | 'models' | 'ollama' | 'gemini' | 'copilot' | 'unknown';

interface ContextWindow {
  tokens: number | null;
  source: ContextWindowSource;
}

interface ContextRingProps {
  providerId: string;
  modelId: string;
  /** Tokens the last turn actually occupied (prompt + completion). */
  used: number;
}

const SIZE = 28;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 17005 -> "17.0k", 1048576 -> "1.0M" */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const SOURCE_LABELS: Record<ContextWindowSource, string> = {
  manual: 'set by hand',
  props: 'reported by the server',
  models: 'from the model listing',
  ollama: 'reported by Ollama',
  gemini: 'reported by Google',
  copilot: 'reported by Copilot',
  unknown: 'unknown',
};

export const ContextRing: React.FC<ContextRingProps> = ({ providerId, modelId, used }) => {
  const [ctx, setCtx] = useState<ContextWindow>({ tokens: null, source: 'unknown' });
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const invoke = (channel: string, ...args: any[]) =>
    (window as any).electron.invoke(channel, ...args);

  useEffect(() => {
    let cancelled = false;
    if (!providerId || !modelId) {
      setCtx({ tokens: null, source: 'unknown' });
      return;
    }
    // Probing a remote endpoint can take a moment; drop the result if the model
    // changed while it was in flight.
    void Promise.resolve(invoke('chat:get-context-window', providerId, modelId))
      .then((w: ContextWindow) => { if (!cancelled && w) setCtx(w); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [providerId, modelId]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const total = ctx.tokens;
  const ratio = total ? used / total : 0;
  const percent = Math.round(ratio * 100);
  const known = total !== null && total > 0;

  // Blue while there is room, warmer as it fills -- the failure mode this ring
  // exists to warn about is a request that no longer fits.
  const color = !known || used === 0
    ? 'var(--text-muted)'
    : percent >= 90
      ? '#f87171'
      : percent >= 75
        ? '#fbbf24'
        : 'var(--accent-primary)';

  const dashOffset = CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, ratio)));

  const openEditor = () => {
    setDraft(total ? String(total) : '');
    setEditing(true);
  };

  const save = async () => {
    const parsed = parseInt(draft.replace(/[^0-9]/g, ''), 10);
    const next = await invoke('chat:set-context-window', providerId, modelId, Number.isFinite(parsed) ? parsed : null);
    if (next) setCtx(next);
    setEditing(false);
  };

  const clear = async () => {
    const next = await invoke('chat:set-context-window', providerId, modelId, null);
    if (next) setCtx(next);
    setEditing(false);
  };

  const tooltip = known
    ? `Context ${compact(used)} / ${compact(total!)} (${percent}%)`
    : used > 0
      ? `Context ${compact(used)} — window unknown`
      : 'Context — window unknown';

  return (
    <div className="relative flex items-center">
      <button
        onClick={openEditor}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="p-1 rounded-lg hover:bg-surface-light transition-colors"
        aria-label={tooltip}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke="var(--border-color)" strokeWidth={STROKE}
          />
          {known && used > 0 && (
            <circle
              cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
              fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE} strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-500"
            />
          )}
        </svg>
      </button>

      {hovered && !editing && (
        <div className="absolute bottom-full right-0 mb-2 px-2 py-1 rounded-md bg-elevated border border-border text-[11px] text-text-main whitespace-nowrap shadow-lg pointer-events-none z-50">
          {tooltip}
          <div className="text-[10px] text-text-muted">
            {known ? `Window ${SOURCE_LABELS[ctx.source]} · click to change` : 'Click to set it'}
          </div>
        </div>
      )}

      {editing && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditing(false)} />
          <div className="absolute bottom-full right-0 mb-2 p-3 rounded-lg bg-surface border border-border shadow-xl z-50 w-60">
            <label className="block text-xs font-medium text-text-main mb-1">Context window (tokens)</label>
            <p className="text-[10px] text-text-muted mb-2">
              The limit comes from how the server was started, not from the model. Leave empty to detect it again.
            </p>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder="e.g. 32768"
              inputMode="numeric"
              className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-text-main focus:border-primary outline-none"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={save} className="flex-1 px-2 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:opacity-90">
                Save
              </button>
              <button onClick={clear} className="px-2 py-1.5 bg-surface-light text-text-main text-xs rounded-lg hover:bg-surface">
                Auto
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
