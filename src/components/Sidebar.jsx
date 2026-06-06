import { useState } from 'react'
import { Plus, MessageSquare, Settings, Wifi, WifiOff } from 'lucide-react'
import { useAppStore, useMainChat, useSideChat } from '../store/chatStore'

export default function Sidebar() {
  const { chatSessions, activeChatId, ollamaConnected, setActiveChatId } = useAppStore()
  const clearMain = useMainChat(s => s.clearMessages)
  const clearSide = useSideChat(s => s.clearMessages)
  const loadMessages = useMainChat(s => s.loadMessages)

  const handleNewChat = () => {
    clearMain()
    clearSide()
    setActiveChatId(null)
  }

  const handleLoadSession = (session) => {
    if (session.messages) loadMessages(session.messages, session.model)
    setActiveChatId(session.id)
  }

  return (
    <div style={{
      width: '220px',
      minWidth: '220px',
      background: '#0a0a0c',
      borderRight: '1px solid #1a1a1e',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Syne', sans-serif",
    }}>
      {/* New chat button */}
      <div style={{ padding: '12px 10px 8px' }}>
        <button
          onClick={handleNewChat}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'transparent',
            border: '1px solid #2a2a30',
            borderRadius: '6px',
            color: '#9090a0',
            fontSize: '12px',
            fontFamily: "'Syne', sans-serif",
            fontWeight: '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s',
            letterSpacing: '0.04em',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#1a1a1e'
            e.currentTarget.style.color = '#e2e2e8'
            e.currentTarget.style.borderColor = '#3a3a44'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#9090a0'
            e.currentTarget.style.borderColor = '#2a2a30'
          }}
        >
          <Plus size={13} />
          New Chat
        </button>
      </div>

      {/* Chat list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px 8px',
      }}>
        <div style={{
          fontSize: '10px',
          color: '#404050',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          padding: '8px 6px 6px',
          fontWeight: '600',
        }}>
          Recent
        </div>

        {chatSessions.length === 0 && (
          <div style={{
            padding: '12px 8px',
            fontSize: '11px',
            color: '#404050',
            lineHeight: 1.5,
          }}>
            No chats yet. Start a conversation.
          </div>
        )}

        {chatSessions.map(session => (
          <button
            key={session.id}
            onClick={() => handleLoadSession(session)}
            style={{
              width: '100%',
              padding: '7px 8px',
              background: activeChatId === session.id ? '#1a1a1e' : 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: activeChatId === session.id ? '#e2e2e8' : '#6b6b7a',
              fontSize: '12px',
              fontFamily: "'Syne', sans-serif",
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'left',
              transition: 'all 0.15s',
              overflow: 'hidden',
            }}
            onMouseEnter={e => {
              if (activeChatId !== session.id) {
                e.currentTarget.style.background = '#141418'
                e.currentTarget.style.color = '#c0c0cc'
              }
            }}
            onMouseLeave={e => {
              if (activeChatId !== session.id) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#6b6b7a'
              }
            }}
          >
            <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '11px',
            }}>
              {session.title}
            </span>
          </button>
        ))}
      </div>

      {/* Bottom status */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid #1a1a1e',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        {ollamaConnected
          ? <Wifi size={11} color="#4ade80" />
          : <WifiOff size={11} color="#f87171" />
        }
        <span style={{
          fontSize: '10px',
          color: ollamaConnected ? '#4ade80' : '#f87171',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {ollamaConnected ? 'Ollama connected' : 'Ollama offline'}
        </span>
      </div>
    </div>
  )
}
