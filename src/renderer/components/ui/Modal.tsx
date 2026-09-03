import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  alwaysShowScrollbar?: boolean;
}

export function Modal({ isOpen, onClose, title, children, width = 'max-w-md', alwaysShowScrollbar = false }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           exit={{ opacity: 0, scale: 0.95 }}
           className={`bg-surface border border-border rounded-xl shadow-xl w-full ${width} max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col`}
        >
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-text-main">{title}</h3>
            <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className={`p-0 flex-1 ${alwaysShowScrollbar ? 'overflow-y-scroll [scrollbar-gutter:stable]' : 'overflow-y-auto'}`}>
            {children}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
