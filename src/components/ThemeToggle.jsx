import { Sun, Moon } from 'lucide-react'
import { useSettingsStore } from '../store/settingsStore'
import styles from './ThemeToggle.module.css'

export default function ThemeToggle() {
  const theme = useSettingsStore(s => s.theme)
  const toggleTheme = useSettingsStore(s => s.toggleTheme)
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
