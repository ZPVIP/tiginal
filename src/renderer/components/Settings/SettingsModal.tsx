import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Square, X } from 'lucide-react';
import { Settings } from './Settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const isMacOS = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 900, height: 680 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const computeSize = () => {
      const width = Math.min(900, Math.max(640, window.innerWidth - 80));
      const height = Math.min(760, Math.max(520, window.innerHeight - 80));
      setSize({ width, height });
      return { width, height };
    };
    const center = () => {
      const nextSize = computeSize();
      const x = Math.max(12, Math.round((window.innerWidth - nextSize.width) / 2));
      const y = Math.max(12, Math.round((window.innerHeight - nextSize.height) / 2));
      setPosition({ x, y });
    };
    center();
    const onResize = () => {
      if (!isDragging) center();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen, isDragging]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const width = size.width;
      const height = size.height;
      const maxX = Math.max(12, window.innerWidth - width - 12);
      const maxY = Math.max(12, window.innerHeight - height - 12);
      const nextX = Math.min(maxX, Math.max(12, e.clientX - dragOffset.x));
      const nextY = Math.min(maxY, Math.max(12, e.clientY - dragOffset.y));
      setPosition({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, size]);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-window-control]')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={modalRef}
        className="settings-modal absolute bg-surface border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          left: 0,
          top: 0,
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          width: `${size.width}px`,
          height: `${size.height}px`,
          // Font sizing variables for Settings UI
          ['--settings-title-size' as any]: '14px',
          ['--settings-text-size' as any]: '12px',
          ['--settings-muted-size' as any]: '10px'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="h-10 min-h-10 max-h-10 px-3 border-b border-border bg-background/40 flex items-center justify-between cursor-move select-none"
          onMouseDown={handleHeaderMouseDown}
        >
          <div className="flex items-center gap-3">
            {isMacOS && (
              <div className="flex items-center gap-2" data-window-control>
                <button
                  className="h-3 w-3 rounded-full bg-red-500 hover:bg-red-400"
                  title="Close"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={onClose}
                />
                <button
                  className="h-3 w-3 rounded-full bg-yellow-500 hover:bg-yellow-400"
                  title="Minimize"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setIsMinimized(prev => !prev)}
                />
                <button
                  className="h-3 w-3 rounded-full bg-green-500/50 cursor-not-allowed"
                  title="Maximize disabled for modal"
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled
                />
              </div>
            )}
            <div className="text-sm font-semibold text-text-main">Settings</div>
          </div>

          {!isMacOS && (
            <div className="flex items-center gap-1" data-window-control>
              <button
                className="h-7 w-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-main hover:bg-white/10"
                title="Minimize"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setIsMinimized(prev => !prev)}
              >
                <Minus size={14} />
              </button>
              <button
                className="h-7 w-8 rounded-md flex items-center justify-center text-text-muted/60 cursor-not-allowed"
                title="Maximize disabled for modal"
                onMouseDown={(e) => e.stopPropagation()}
                disabled
              >
                <Square size={12} />
              </button>
              <button
                className="h-7 w-8 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-red-500"
                title="Close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onClose}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        <div className={isMinimized ? 'hidden' : 'flex-1 min-h-0'}>
          <Settings />
        </div>
      </div>
    </div>,
    document.body
  );
}
