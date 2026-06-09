import { Sun, Moon } from 'lucide-react'
import { useUiStore } from '../store/uiStore'
import styles from './ThemeToggle.module.css'

export default function ThemeToggle() {
  const theme = useUiStore(s => s.theme)
  const toggleTheme = useUiStore(s => s.toggleTheme)
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={styles.toggle}
    >
      {isDark ? <Sun size={13} /> : <Moon size={13} />}
    </button>
  )
}
