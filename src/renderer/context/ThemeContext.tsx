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

/** Key shared with the boot script in index.html. */
export const THEME_CACHE_KEY = 'tiginal:theme-vars';

/**
 * Every CSS variable a theme drives, as a plain map. Kept separate from the
 * DOM write so the exact same values can be cached for the next startup.
 */
export function buildThemeVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {
    // background and text are sourced from terminal config for consistency
    '--bg-primary': theme.terminal.background as string,
    '--bg-secondary': theme.colors.surface,
    '--bg-tertiary': theme.colors.sidebar,
    '--bg-elevated': theme.colors.elevated,
    '--border-color': theme.colors.border,
    '--text-primary': theme.terminal.foreground as string,
    '--text-secondary': theme.colors.textSecondary,
    '--text-muted': theme.colors.textMuted,
    '--accent-primary': theme.colors.primary,
    '--tab-active': theme.colors.tabActive,
    '--tab-hover': theme.colors.tabHover,
    '--split-border-active': theme.colors.splitBorderActive,
  };

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
    if (typeof value === 'string') vars[cssVar] = value;
  }

  vars['--primary-foreground'] = foregroundFor(theme.colors.primary);

  // A normal card border can be intentionally subtle, but an off switch must
  // still read as an interactive control. Use each theme's hover surface for
  // the track and select the least prominent theme text colour that reaches
  // 3:1 against both the track and the surrounding surface.
  const offTrack = theme.colors.tabHover;
  const mutedClearsControlContrast =
    contrast(theme.colors.textMuted, offTrack) >= 3 &&
    contrast(theme.colors.textMuted, theme.colors.surface) >= 3;
  const offControl = mutedClearsControlContrast
    ? theme.colors.textMuted
    : theme.colors.textSecondary;
  vars['--toggle-off-track'] = offTrack;
  vars['--toggle-off-border'] = offControl;
  vars['--toggle-off-thumb'] = offControl;

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

  vars['--code-fg'] = codeHex;
  // Barely-there wash: the tint pulls the background toward the text, so any
  // more of it costs contrast. 3.5% is the most every theme can carry and
  // still clear 4.5:1.
  vars['--code-bg'] = withAlpha(codeHex, 0.035);
  vars['--code-border'] = withAlpha(codeHex, 0.16);

  return vars;
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
    const vars = buildThemeVars(theme);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.setAttribute('data-theme-type', theme.type);

    // Cached so the boot script in index.html can paint the right colours
    // before this provider mounts; see THEME_CACHE_KEY there.
    try {
      localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ type: theme.type, vars }));
    } catch {
      /* private mode or quota; the flash is cosmetic */
    }

    // We can also broadcast an event if needed outside of React context
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }));
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, availableThemes: themes }}>
      {children}
    </ThemeContext.Provider>
  );
}
