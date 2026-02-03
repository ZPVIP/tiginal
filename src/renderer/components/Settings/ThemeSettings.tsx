import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { Theme } from '../../themes';

export function ThemeSettings() {
  const { currentTheme, setTheme, availableThemes } = useTheme();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="space-y-4">
        <div>
           <h3 className="text-xl font-semibold text-[color:var(--text-primary)]">Appearance</h3>
           <p className="text-sm text-[color:var(--text-muted)]">
             Choose a theme to personalize your terminal and workspace.
           </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {availableThemes.map(theme => (
             <ThemeCard 
               key={theme.id} 
               theme={theme} 
               isActive={currentTheme.id === theme.id} 
               onClick={() => setTheme(theme.id)}
             />
          ))}
        </div>
      </section>
    </div>
  );
}

function ThemeCard({ theme, isActive, onClick }: { theme: Theme, isActive: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={clsx(
        "group relative flex flex-col w-full text-left rounded-lg border transition-all duration-200 overflow-hidden ring-offset-2 ring-offset-[color:var(--bg-primary)] focus:outline-none focus:ring-2",
        isActive 
          ? "border-[color:var(--accent-primary)] ring-[color:var(--accent-primary)]" 
          : "border-[color:var(--border-color)] hover:border-[color:var(--text-secondary)]"
      )}
    >
      {/* Mini Preview */}
      <div className="h-24 w-full flex" style={{ backgroundColor: theme.terminal.background }}>
         {/* Sidebar Preview */}
         <div className="w-8 h-full flex flex-col gap-2 items-center pt-2 border-r" style={{ backgroundColor: theme.colors.sidebar, borderColor: theme.colors.border }}>
            <div className="w-4 h-4 rounded bg-[color:var(--text-muted)] opacity-20" />
            <div className="w-4 h-4 rounded bg-[color:var(--text-muted)] opacity-20" />
         </div>
         {/* Main Content Preview */}
         <div className="flex-1 p-2 flex flex-col gap-2">
            {/* Fake Title Bar */}
            <div className="w-full h-2 rounded-sm" style={{ backgroundColor: theme.colors.elevated }} />
            {/* Fake Code */}
            <div className="space-y-1 mt-1">
               <div className="w-3/4 h-1.5 rounded-sm" style={{ backgroundColor: theme.colors.primary, opacity: 0.5 }} />
               <div className="w-1/2 h-1.5 rounded-sm" style={{ backgroundColor: theme.colors.textSecondary, opacity: 0.5 }} />
            </div>
         </div>
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-[color:var(--bg-elevated)] w-full flex items-center justify-between border-t" style={{ borderColor: theme.colors.border }}>
         <div className="flex flex-col">
           <span className="text-sm font-medium text-[color:var(--text-primary)]">{theme.name}</span>
           <span className="text-xs text-[color:var(--text-muted)] capitalize">{theme.type}</span>
         </div>
         {isActive && (
           <div className="p-1 rounded-full bg-[color:var(--accent-primary)] text-[color:var(--bg-tertiary)]">
             <Check size={12} strokeWidth={3} />
           </div>
         )}
      </div>
    </button>
  );
}
