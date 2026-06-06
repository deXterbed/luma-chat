import { useEffect, useRef, useState } from 'react'
import ChatPane from './ChatPane'
import { useAppStore } from '../store/appStore'
import { useMainChat, useSideChat } from '../store/chatStore'

export default function SidePanel() {
  const { chatSessions, activeChatId, addSideChat, setActiveSideChatId } = useAppStore()

  const currentSession = chatSessions.find(s => s.id === activeChatId) ?? null
  const sessionSideChats = currentSession?.sideChats ?? []
  const activeSideChatId = currentSession?.activeSideChatId ?? null

  const [sideWidth, setSideWidth] = useState(380)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  // Resize drag
  const onMouseDown = (e) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = sideWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return
      const delta = dragStartX.current - e.clientX
      setSideWidth(Math.max(280, Math.min(600, dragStartWidth.current + delta)))
    }
    const onMouseUp = () => {
      isDragging.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Load the correct side chat when the active session changes
  useEffect(() => {
    if (!activeChatId || !currentSession) return
    if (sessionSideChats.length === 0) {
      addSideChat(activeChatId, useSideChat.getState().model)
      useSideChat.getState().clearMessages()
    } else {
      const sc = sessionSideChats.find(sc => sc.id === activeSideChatId) ?? sessionSideChats[0]
      useSideChat.getState().loadMessages(sc.messages ?? [], sc.model ?? 'minimax-m3:cloud')
      if (!activeSideChatId) setActiveSideChatId(activeChatId, sc.id)
    }
  }, [activeChatId])

  // Clear side chat when no session is active
  useEffect(() => {
    if (!activeChatId) useSideChat.getState().clearMessages()
  }, [activeChatId])

  const handleAddSideChat = () => {
    if (!activeChatId) return
    addSideChat(activeChatId, useSideChat.getState().model)
    useSideChat.getState().clearMessages()
  }

  const handleSwitchSideChat = (id) => {
    const sc = sessionSideChats.find(sc => sc.id === id)
    if (!sc) return
    useSideChat.getState().loadMessages(sc.messages ?? [], sc.model ?? 'minimax-m3:cloud')
    setActiveSideChatId(activeChatId, id)
  }

  return (
    <>
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          width: '4px',
          background: '#1a1a1e',
          cursor: 'col-resize',
          flexShrink: 0,
          transition: 'background 0.15s',
          zIndex: 10,
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#a78bfa44'}
        onMouseLeave={e => e.currentTarget.style.background = '#1a1a1e'}
      />

      {/* Panel */}
      <div style={{
        width: `${sideWidth}px`,
        minWidth: '280px',
        maxWidth: '600px',
        borderLeft: '1px solid #1a1a1e',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideInRight 0.2s ease-out',
      }}>
        {/* Tab bar */}
        {activeSideChatId && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #1a1a1e',
            background: '#0a0a0c',
            flexShrink: 0,
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}>
            {sessionSideChats.map((sc, i) => (
              <button
                key={sc.id}
                onClick={() => handleSwitchSideChat(sc.id)}
                style={{
                  padding: '6px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: sc.id === activeSideChatId ? '2px solid #a78bfa' : '2px solid transparent',
                  color: sc.id === activeSideChatId ? '#a78bfa' : '#404050',
                  fontSize: '10px',
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (sc.id !== activeSideChatId) e.currentTarget.style.color = '#8080a0' }}
                onMouseLeave={e => { if (sc.id !== activeSideChatId) e.currentTarget.style.color = '#404050' }}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={handleAddSideChat}
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: 'none',
                color: '#404050',
                fontSize: '14px',
                cursor: 'pointer',
                flexShrink: 0,
                lineHeight: 1,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
              onMouseLeave={e => e.currentTarget.style.color = '#404050'}
              title="New side chat"
            >
              +
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ChatPane
            key={activeSideChatId ?? 'default'}
            store={useSideChat}
            contextStore={useMainChat}
            sideChatId={activeSideChatId}
            sessionId={activeChatId}
            placeholder="Side questions…"
            label="Side Chat"
            compact={true}
          />
        </div>
      </div>
    </>
  )
}
