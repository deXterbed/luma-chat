import { Sun, Moon } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import { getTheme } from '../theme'

export default function ThemeToggle() {
  const theme = useUiStore(s => s.theme)
  const toggleTheme = useUiStore(s => s.toggleTheme)
  const t = getTheme(theme)
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      style={{
        WebkitAppRegion: 'no-drag',
        width: '34px',
        height: '34px',
        background: 'transparent',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: t.winBtnColor,
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = t.winBtnHover
        e.currentTarget.style.color = t.winBtnColorHover
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = t.winBtnColor
      }}
    >
      {isDark ? <Sun size={13} /> : <Moon size={13} />}
    </button>
  )
}
