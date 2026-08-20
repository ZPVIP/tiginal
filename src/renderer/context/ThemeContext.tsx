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

/** WCAG relative luminance, for deciding what to put on top of a colour. */
function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 21;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `#rrggbb` plus an alpha, as an rgba() string. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Text colour for filled accent buttons. White is the conventional look and is
 * kept whenever it clears AA; only pale accents (Monokai's green at 1.6:1,
 * Tiginal's blue at 2.1:1) fall back to near-black.
 */
function foregroundFor(accent: string): string {
  const lum = relativeLuminance(accent);
  if (lum === null) return '#ffffff';
  const whiteContrast = 1.05 / (lum + 0.05);
  return whiteContrast >= 4.5 ? '#ffffff' : '#0d0d0d';
}

  const applyTheme = (theme: Theme) => {
    setCurrentThemeState(theme);
    
    const root = document.documentElement;
    
    // Apply CSS variables
    // background and text are sourced from terminal config for consistency
    root.style.setProperty('--bg-primary', theme.terminal.background as string);
    root.style.setProperty('--bg-secondary', theme.colors.surface);
    root.style.setProperty('--bg-tertiary', theme.colors.sidebar);
    root.style.setProperty('--bg-elevated', theme.colors.elevated);
    root.style.setProperty('--border-color', theme.colors.border);
    root.style.setProperty('--text-primary', theme.terminal.foreground as string);
    root.style.setProperty('--text-secondary', theme.colors.textSecondary);
    root.style.setProperty('--text-muted', theme.colors.textMuted);
    root.style.setProperty('--accent-primary', theme.colors.primary);
    root.style.setProperty('--tab-active', theme.colors.tabActive);
    root.style.setProperty('--tab-hover', theme.colors.tabHover);
    root.style.setProperty('--split-border-active', theme.colors.splitBorderActive);

    // The terminal palette is already tuned per theme, so reuse it for accents
    // that need to sit on this theme's background (tool names, diagnostics).
    const ansi: Array<[string, keyof typeof theme.terminal]> = [
      ['--ansi-red', 'red'],
      ['--ansi-green', 'green'],
      ['--ansi-yellow', 'yellow'],
      ['--ansi-blue', 'blue'],
      ['--ansi-magenta', 'magenta'],
      ['--ansi-cyan', 'cyan'],
      // Dark themes need the bright variant for inline code: vs-code-dark's
      // plain blue only reaches 3.6:1 on its own surface.
      ['--ansi-bright-blue', 'brightBlue'],
    ];
    for (const [cssVar, key] of ansi) {
      const value = theme.terminal[key];
      if (typeof value === 'string') root.style.setProperty(cssVar, value);
    }

    // Semantic accents are picked per light/dark rather than per theme, because
    // what matters is contrast against a light or a dark surface.
    root.setAttribute('data-theme-type', theme.type);
    root.style.setProperty('--primary-foreground', foregroundFor(theme.colors.primary));

    // Inline code prefers the theme's own accent -- the colour it already uses
    // for interactive text, and generally the tastefully desaturated one. Where
    // that accent is too dim to read on the surface (VS Code's #007acc lands
    // near 3.8:1) it falls back to the palette's blue.
    const paletteBlue = String(
      (theme.type === 'light' ? theme.terminal.blue : theme.terminal.brightBlue) || ''
    );
    const accent = theme.colors.primary;
    const codeHex = contrast(accent, theme.colors.surface) >= 4.6 || !paletteBlue
      ? accent
      : paletteBlue;

    root.style.setProperty('--code-fg', codeHex);
    // Barely-there wash: the tint pulls the background toward the text, so any
    // more of it costs contrast. 3.5% is the most every theme can carry and
    // still clear 4.5:1.
    root.style.setProperty('--code-bg', withAlpha(codeHex, 0.035));
    root.style.setProperty('--code-border', withAlpha(codeHex, 0.16));
    
    // We can also broadcast an event if needed outside of React context
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }));
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, availableThemes: themes }}>
      {children}
    </ThemeContext.Provider>
  );
}
