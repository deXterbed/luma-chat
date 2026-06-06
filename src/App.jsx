import { useEffect } from 'react'
import { PanelRight, PanelRightClose } from 'lucide-react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatPane from './components/ChatPane'
import SidePanel from './components/SidePanel'
import { useAppStore } from './store/appStore'
import { useMainChat } from './store/chatStore'
import { fetchModels } from './lib/ollama'
import './index.css'

export default function App() {
  const { sideChatOpen, toggleSideChat, setAvailableModels, setOllamaConnected } = useAppStore()

  useEffect(() => {
    fetchModels().then(models => {
      if (models.length > 0) {
        setAvailableModels(models)
        setOllamaConnected(true)
      } else {
        setOllamaConnected(false)
      }
    })
  }, [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: '#0e0e10',
      overflow: 'hidden',
      fontFamily: "'Syne', sans-serif",
    }}>
      <TitleBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top bar */}
          <div style={{
            padding: '0 16px',
            height: '38px',
            background: '#0a0a0c',
            borderBottom: '1px solid #1a1a1e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}>
            <button
              onClick={toggleSideChat}
              style={{
                background: sideChatOpen ? '#1e1e2a' : 'transparent',
                border: sideChatOpen ? '1px solid #3a3a4e' : '1px solid #1e1e24',
                borderRadius: '5px',
                padding: '4px 10px',
                color: sideChatOpen ? '#a78bfa' : '#505060',
                fontSize: '11px',
                fontFamily: "'Syne', sans-serif",
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s',
                letterSpacing: '0.04em',
              }}
              onMouseEnter={e => {
                if (!sideChatOpen) {
                  e.currentTarget.style.background = '#141418'
                  e.currentTarget.style.color = '#8080c0'
                  e.currentTarget.style.borderColor = '#2a2a38'
                }
              }}
              onMouseLeave={e => {
                if (!sideChatOpen) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = '#505060'
                  e.currentTarget.style.borderColor = '#1e1e24'
                }
              }}
            >
              {sideChatOpen
                ? <><PanelRightClose size={12} /> Close Side Chat</>
                : <><PanelRight size={12} /> Side Chat</>
              }
            </button>
          </div>

          {/* Chat area */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', transition: 'flex 0.25s ease' }}>
              <ChatPane
                store={useMainChat}
                placeholder="Ask anything…"
                label="Main Chat"
              />
            </div>
            {sideChatOpen && <SidePanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
