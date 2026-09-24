import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';

interface AudioWaveformPlayerProps {
  audioUrl: string;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const whole = Math.floor(value);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function AudioWaveformPlayer({ audioUrl }: AudioWaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !audioUrl) return;
    const styles = getComputedStyle(document.documentElement);
    const waveColor = styles.getPropertyValue('--text-muted').trim() || '#777';
    const progressColor = styles.getPropertyValue('--accent-primary').trim() || '#7c3aed';
    const cursorColor = styles.getPropertyValue('--text-primary').trim() || '#fff';
    const waveSurfer = WaveSurfer.create({
      container,
      url: audioUrl,
      height: 64,
      waveColor,
      progressColor,
      cursorColor,
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      backend: 'MediaElement',
    });
    waveSurferRef.current = waveSurfer;

    const subscriptions = [
      waveSurfer.on('ready', value => setDuration(value)),
      waveSurfer.on('timeupdate', value => setCurrentTime(value)),
      waveSurfer.on('play', () => setIsPlaying(true)),
      waveSurfer.on('pause', () => setIsPlaying(false)),
      waveSurfer.on('finish', () => setIsPlaying(false)),
      waveSurfer.on('error', err => console.warn('[WaveSurfer error]', err)),
    ];

    return () => {
      subscriptions.forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch {}
      });
      try {
        waveSurfer.destroy();
      } catch {}
      waveSurferRef.current = null;
    };
  }, [audioUrl]);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        title={isPlaying ? 'Pause' : 'Play'}
        onClick={() => void waveSurferRef.current?.playPause()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-text-muted">
        {formatTime(currentTime)}
      </span>
      <div ref={containerRef} className="min-w-0 flex-1 cursor-pointer" />
      <span className="w-10 shrink-0 font-mono text-[11px] text-text-muted">
        {formatTime(duration)}
      </span>
      <Volume2 size={15} className="shrink-0 text-text-muted" />
      <input
        type="range"
        aria-label="Playback volume"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={event => {
          const nextVolume = Number(event.target.value);
          setVolume(nextVolume);
          waveSurferRef.current?.setVolume(nextVolume);
        }}
        className="w-20 accent-primary"
      />
    </div>
  );
}
