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

    let animationFrameId: number | null = null;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const scale = window.devicePixelRatio || 1;
      const targetWidth = Math.max(1, Math.round(rect.width * scale));
      const targetHeight = Math.max(1, Math.round(rect.height * scale));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

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

    animationFrameId = requestAnimationFrame(draw);

    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(canvas);

    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      observer.disconnect();
    };
  }, [active, peaks]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={active ? 'Live microphone waveform' : 'Microphone waveform'}
      className="h-16 w-full rounded-lg bg-surface-light"
    />
  );
}
