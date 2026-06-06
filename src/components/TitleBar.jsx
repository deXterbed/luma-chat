import { useState, useEffect } from 'react'
import { Minus, Square, X, Maximize2 } from 'lucide-react'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!window.electron) return
    window.electron.isMaximized().then(setIsMaximized)
    window.electron.onMaximized(setIsMaximized)
  }, [])

  const handleMinimize = () => window.electron?.minimize()
  const handleMaximize = () => window.electron?.maximize()
  const handleClose = () => window.electron?.close()

  return (
    <div
      className="titlebar"
      style={{
        WebkitAppRegion: 'drag',
        height: '38px',
        background: '#0e0e10',
        borderBottom: '1px solid #1a1a1e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '16px',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* App name */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
        }} />
        <span style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: '12px',
          fontWeight: '600',
          color: '#6b6b7a',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          Luma
        </span>
      </div>

      {/* Windows controls */}
      <div
        style={{ WebkitAppRegion: 'no-drag', display: 'flex' }}
      >
        <button
          onClick={handleMinimize}
          className="win-btn"
          style={{
            width: '46px',
            height: '38px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b6b7a',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1e'; e.currentTarget.style.color = '#e2e2e8' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b6b7a' }}
        >
          <Minus size={12} />
        </button>
        <button
          onClick={handleMaximize}
          style={{
            width: '46px',
            height: '38px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b6b7a',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1e'; e.currentTarget.style.color = '#e2e2e8' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b6b7a' }}
        >
          {isMaximized ? <Square size={11} /> : <Maximize2 size={11} />}
        </button>
        <button
          onClick={handleClose}
          style={{
            width: '46px',
            height: '38px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b6b7a',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#c0392b'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b6b7a' }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
