import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { SettingsPageHeader } from './SettingsPageHeader';

const invoke = (window as any).electron?.invoke || (async () => {});

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

interface ProviderStats {
  providerId: string;
  providerName: string;
  modelId: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export function StatisticsSettings() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<ProviderStats[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleQuery = async () => {
    setLoading(true);
    try {
      const result = await invoke('statistics:query', { startDate, endDate });
      setData(result.providers);
    } catch (err) {
      console.error('Failed to query statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  const grandTotal = data ? data.reduce((sum, p) => sum + p.totalTokens, 0) : 0;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={<BarChart3 size={24} />}
        title="Statistics"
      />

      {/* Date Range */}
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-elevated border border-border rounded px-3 py-2 text-sm text-text-main"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-elevated border border-border rounded px-3 py-2 text-sm text-text-main"
          />
        </div>
        <button
          onClick={handleQuery}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/80 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {loading ? 'Loading...' : 'Statistics'}
        </button>
      </div>

      {data && data.length === 0 && (
        <p className="text-text-muted text-sm">No token usage data found for this date range.</p>
      )}

      {data && data.length > 0 && (
        <div className="space-y-8">
          {/* Summary */}
          <div className="bg-elevated rounded-lg p-4 border border-border">
            <div className="text-sm text-text-muted mb-1">Total Tokens</div>
            <div className="text-2xl font-bold text-text-main">{grandTotal.toLocaleString()}</div>
          </div>

          {/* Pie Chart */}
          <div>
            <h4 className="text-sm font-semibold mb-4">Token Distribution by Provider</h4>
            <div className="flex items-center gap-8">
              <PieChart data={data.map((p, i) => ({ label: p.providerName, value: p.totalTokens, color: COLORS[i % COLORS.length] }))} />
              <div className="flex flex-col gap-2">
                {data.map((p, i) => (
                  <div key={p.providerId} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-text-main">{p.providerName}</span>
                    <span className="text-text-muted ml-auto tabular-nums">{p.totalTokens.toLocaleString()}</span>
                    <span className="text-text-muted text-xs w-12 text-right">({((p.totalTokens / grandTotal) * 100).toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bar Chart */}
          <div>
            <h4 className="text-sm font-semibold mb-4">Prompt vs Completion Tokens</h4>
            <BarChart data={data.map((p, i) => ({
              label: p.providerName,
              prompt: p.promptTokens,
              completion: p.completionTokens,
              color: COLORS[i % COLORS.length],
            }))} />
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                <span>Prompt Tokens</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-sky-500" />
                <span>Completion Tokens</span>
              </div>
            </div>
          </div>

          {/* Detailed Table */}
          <div>
            <h4 className="text-sm font-semibold mb-4">Details</h4>
            <div className="bg-elevated rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-text-muted font-medium">Provider</th>
                    <th className="text-right p-3 text-text-muted font-medium">Prompt</th>
                    <th className="text-right p-3 text-text-muted font-medium">Cached</th>
                    <th className="text-right p-3 text-text-muted font-medium">Completion</th>
                    <th className="text-right p-3 text-text-muted font-medium">Reasoning</th>
                    <th className="text-right p-3 text-text-muted font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((p) => (
                    <tr key={p.providerId} className="border-b border-border/50 last:border-0">
                      <td className="p-3 text-text-main">{p.providerName}</td>
                      <td className="p-3 text-right text-text-sec tabular-nums">{p.promptTokens.toLocaleString()}</td>
                      <td className="p-3 text-right text-text-sec tabular-nums">{p.cachedTokens.toLocaleString()}</td>
                      <td className="p-3 text-right text-text-sec tabular-nums">{p.completionTokens.toLocaleString()}</td>
                      <td className="p-3 text-right text-text-sec tabular-nums">{p.reasoningTokens.toLocaleString()}</td>
                      <td className="p-3 text-right text-text-main font-medium tabular-nums">{p.totalTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// SVG Pie Chart Component
function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const size = 200;
  const center = size / 2;
  const radius = 80;

  let cumulativeAngle = -90; // Start at top

  const segments = data.map(d => {
    const angle = (d.value / total) * 360;
    const startAngle = cumulativeAngle;
    cumulativeAngle += angle;
    const endAngle = cumulativeAngle;

    // Convert to radians for SVG path
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    // Handle full circle edge case
    if (data.length === 1) {
      return {
        path: '',
        isCircle: true,
        color: d.color,
        label: d.label,
        percentage: ((d.value / total) * 100).toFixed(1),
      };
    }

    const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return {
      path,
      isCircle: false,
      color: d.color,
      label: d.label,
      percentage: ((d.value / total) * 100).toFixed(1),
    };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-48 h-48 shrink-0">
      {segments.map((seg, i) =>
        seg.isCircle ? (
          <circle key={i} cx={center} cy={center} r={radius} fill={seg.color} opacity={0.85}>
            <title>{seg.label}: {seg.percentage}%</title>
          </circle>
        ) : (
          <path key={i} d={seg.path} fill={seg.color} opacity={0.85}>
            <title>{seg.label}: {seg.percentage}%</title>
          </path>
        )
      )}
    </svg>
  );
}

// Bar Chart Component
function BarChart({ data }: { data: { label: string; prompt: number; completion: number; color: string }[] }) {
  const maxTotal = Math.max(...data.map(d => d.prompt + d.completion), 1);

  return (
    <div className="flex items-end gap-4" style={{ height: '200px' }}>
      {data.map((d, i) => {
        const total = d.prompt + d.completion;
        const heightPercent = (total / maxTotal) * 100;
        const promptPercent = total > 0 ? (d.prompt / total) * 100 : 0;
        const completionPercent = total > 0 ? (d.completion / total) * 100 : 0;

        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1 max-w-[100px] h-full justify-end">
            <div className="text-xs text-text-muted mb-1 tabular-nums">{total.toLocaleString()}</div>
            <div
              className="w-full flex flex-col justify-end rounded-t overflow-hidden"
              style={{ height: `${heightPercent}%`, minHeight: total > 0 ? '4px' : '0' }}
            >
              <div
                className="bg-sky-500"
                style={{ height: `${completionPercent}%` }}
                title={`Completion: ${d.completion.toLocaleString()}`}
              />
              <div
                className="bg-emerald-500"
                style={{ height: `${promptPercent}%` }}
                title={`Prompt: ${d.prompt.toLocaleString()}`}
              />
            </div>
            <span className="text-xs text-text-muted text-center truncate w-full" title={d.label}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
