import { useEffect, useRef } from 'react';

interface LiveWaveformCanvasProps {
  peaks: readonly number[];
  active: boolean;
}

export function LiveWaveformCanvas({ peaks, active }: LiveWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const styles = getComputedStyle(document.documentElement);
      const baselineColor = styles.getPropertyValue('--border-color').trim() || '#555';
      const waveColor = styles.getPropertyValue('--accent-primary').trim() || '#7c3aed';
      const middle = rect.height / 2;

      context.strokeStyle = baselineColor;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, middle);
      context.lineTo(rect.width, middle);
      context.stroke();

      if (peaks.length === 0) return;
      const visibleCount = Math.max(1, Math.floor(rect.width / 3));
      const visiblePeaks = peaks.slice(-visibleCount);
      const barWidth = rect.width / visibleCount;
      context.fillStyle = waveColor;
      for (let index = 0; index < visiblePeaks.length; index += 1) {
        const peak = Math.max(0.015, Math.min(1, visiblePeaks[index] ?? 0));
        const height = peak * Math.max(4, rect.height - 8);
        const x = rect.width - ((visiblePeaks.length - index) * barWidth);
        context.fillRect(x, middle - (height / 2), Math.max(1, barWidth - 1), height);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [active, peaks]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={active ? 'Live microphone waveform' : 'Microphone waveform'}
      className="h-16 w-full rounded-lg bg-surface-light"
    />
  );
}
