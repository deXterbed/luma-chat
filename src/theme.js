// Theme palettes. Colors are also expressed as CSS custom properties in
// src/index.css — this object mirrors them so JS hover handlers and
// dynamic style updates can use the same values without hardcoding hex.

export const themes = {
  dark: {
    name: 'dark',
    // Surfaces
    bg: '#0e0e10',
    bgAlt: '#0a0a0c',
    surface: '#141418',
    surfaceHover: '#1a1a1e',
    surfaceActive: '#1e1e2a',
    // Borders
    border: '#1a1a1e',
    borderStrong: '#2a2a30',
    // Text
    text: '#d4d4dc',
    textMuted: '#6b6b7a',
    textFaint: '#404050',
    textSubtle: '#8080a0',
    // Accents
    accent: '#a78bfa',
    accentSubtle: '#a78bfa44',
    accentDim: '#7070a0',
    // Code / markdown
    codeBg: '#1a1a24',
    codeBorder: '#2a2a34',
    codeText: '#a78bfa',
    preBg: '#0a0a10',
    preBorder: '#1e1e2a',
    preText: '#c0c0d0',
    mdHeading: '#c0c0d4',
    mdStrong: '#c8c8dc',
    mdBlockquoteBorder: '#3a3a50',
    mdBlockquoteText: '#7070a0',
    mdThBg: '#141420',
    mdThText: '#9090b0',
    mdTdBorder: '#2a2a34',
    mdTrHover: '#12121a',
    // Scrollbar
    scrollbar: '#2a2a34',
    scrollbarHover: '#3a3a48',
    // Bubbles
    userBubble: '#1e1e2e',
    userBubbleBorder: '#2a2a3e',
    assistantBubble: '#141418',
    assistantBubbleBorder: '#1e1e24',
    // Send button gradient
    sendGradient: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
    sendDisabled: '#1a1a22',
    // Status colors (used in Sidebar ollama pill)
    statusOk: '#4ade80',
    statusErr: '#f87171',
    // Misc
    caretColor: '#a78bfa',
    inputText: '#c0c0cc',
    handlebar: '#1a1a1e',
    sendIcon: '#f87171',
    errorBg: '#1a0a0a',
    errorBorder: '#4a1a1a',
  },
  light: {
    name: 'light',
    bg: '#f7f7fb',
    bgAlt: '#ffffff',
    surface: '#ffffff',
    surfaceHover: '#eef0f6',
    surfaceActive: '#e4e7f1',
    border: '#e3e5ed',
    borderStrong: '#c9cdd9',
    text: '#1d1d23',
    textMuted: '#5a5e6b',
    textFaint: '#9094a3',
    textSubtle: '#5b6376',
    accent: '#7c3aed',
    accentSubtle: '#7c3aed33',
    accentDim: '#5b5b8c',
    codeBg: '#eef0f6',
    codeBorder: '#d4d7e0',
    codeText: '#7c3aed',
    preBg: '#f1f2f8',
    preBorder: '#d4d7e0',
    preText: '#2a2d3a',
    mdHeading: '#1d1d23',
    mdStrong: '#2a2d3a',
    mdBlockquoteBorder: '#c9cdd9',
    mdBlockquoteText: '#5a5e6b',
    mdThBg: '#eef0f6',
    mdThText: '#2a2d3a',
    mdTdBorder: '#d4d7e0',
    mdTrHover: '#f1f2f8',
    scrollbar: '#c9cdd9',
    scrollbarHover: '#a8adba',
    userBubble: '#ede9fe',
    userBubbleBorder: '#c4b5fd',
    assistantBubble: '#ffffff',
    assistantBubbleBorder: '#e3e5ed',
    sendGradient: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
    sendDisabled: '#e4e7f1',
    statusOk: '#16a34a',
    statusErr: '#dc2626',
    caretColor: '#7c3aed',
    inputText: '#1d1d23',
    handlebar: '#e3e5ed',
    sendIcon: '#dc2626',
    errorBg: '#fef2f2',
    errorBorder: '#fecaca',
  },
}

export function getTheme(name) {
  return themes[name] || themes.dark
}

export function applyTheme(name) {
  const root = document.documentElement
  root.setAttribute('data-theme', name)
}
