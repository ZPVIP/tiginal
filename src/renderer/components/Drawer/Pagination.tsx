import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const [inputValue, setInputValue] = useState('');

  const handlePrev = () => {
    if (currentPage > 0) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      onPageChange(currentPage + 1);
    }
  };

  const handleInputSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const pageNum = parseInt(inputValue, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        onPageChange(pageNum - 1);
        setInputValue('');
      }
    }
  };

  return (
    <div className="flex items-center justify-center gap-1 px-2 py-1 text-xs text-text-muted">
      <button
        onClick={handlePrev}
        disabled={currentPage === 0}
        className="p-0.5 rounded hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={14} />
      </button>
      <span>{currentPage + 1}/{totalPages}</span>
      <button
        onClick={handleNext}
        disabled={currentPage >= totalPages - 1}
        className="p-0.5 rounded hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={14} />
      </button>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleInputSubmit}
        placeholder="#"
        className="w-6 h-5 text-center text-xs bg-surface border border-border-subtle rounded focus:outline-none focus:border-primary"
      />
    </div>
  );
}
