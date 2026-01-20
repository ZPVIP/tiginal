import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Theme, themes } from '../themes';

interface ThemeContextType {
  currentTheme: Theme;
  setTheme: (themeId: string) => Promise<void>;
  availableThemes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [currentTheme, setCurrentThemeState] = useState<Theme>(themes[0]);

  // Load theme on startup
  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      // @ts-ignore - IPC
      const savedThemeId = await window.electron?.invoke('settings:get', 'theme');
      if (savedThemeId) {
        const theme = themes.find(t => t.id === savedThemeId);
        if (theme) {
          applyTheme(theme);
          return;
        }
      }
      // Default fallback
      applyTheme(themes[0]);
    } catch (err) {
      console.error('Failed to load theme:', err);
      applyTheme(themes[0]);
    }
  };

  const setTheme = async (themeId: string) => {
    const theme = themes.find(t => t.id === themeId);
    if (theme) {
      applyTheme(theme);
      // @ts-ignore - IPC
      await window.electron?.invoke('settings:set', 'theme', themeId);
    }
  };

  const applyTheme = (theme: Theme) => {
    setCurrentThemeState(theme);
    
    const root = document.documentElement;
    
    // Apply CSS variables
    root.style.setProperty('--bg-primary', theme.colors.background);
    root.style.setProperty('--bg-secondary', theme.colors.surface);
    root.style.setProperty('--bg-tertiary', theme.colors.sidebar);
    root.style.setProperty('--bg-elevated', theme.colors.elevated);
    root.style.setProperty('--border-color', theme.colors.border);
    root.style.setProperty('--text-primary', theme.colors.text);
    root.style.setProperty('--text-secondary', theme.colors.textSecondary);
    root.style.setProperty('--text-muted', theme.colors.textMuted);
    root.style.setProperty('--accent-primary', theme.colors.primary);
    root.style.setProperty('--tab-active', theme.colors.tabActive);
    root.style.setProperty('--tab-hover', theme.colors.tabHover);
    root.style.setProperty('--split-border-active', theme.colors.splitBorderActive);
    
    // We can also broadcast an event if needed outside of React context
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }));
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, availableThemes: themes }}>
      {children}
    </ThemeContext.Provider>
  );
}
