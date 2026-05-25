import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

interface HistoryItem {
  id: number
  room: string
  message: string
  time: string
  sent: boolean
}

export default function Sender() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [rooms, setRooms] = useState<string[]>([])
  const [selectedRoom, setSelectedRoom] = useState('')
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const historyId = useRef(0)

  useEffect(() => {
    const s = io('/', { transports: ['websocket', 'polling'] })
    setSocket(s)

    s.on('room-list', (list: string[]) => {
      setRooms(list)
      if (!list.includes(selectedRoom) && selectedRoom !== '__all__') {
        // Keep selectedRoom if still valid
      }
    })

    s.on('connect', () => {
      // Fetch initial room list via REST
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((data) => setRooms(data.rooms))
        .catch(() => {})
    })

    return () => {
      s.disconnect()
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function addHistory(room: string, msg: string, sent: boolean) {
    const item: HistoryItem = {
      id: ++historyId.current,
      room: room === '__all__' ? '全部教室' : room,
      message: msg,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      sent,
    }
    setHistory((prev) => [item, ...prev].slice(0, 50))
  }

  async function handleSend() {
    const trimmed = message.trim()
    if (!trimmed) return

    const target = selectedRoom || '__all__'
    setSending(true)
    setStatus('')

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: target, message: trimmed }),
      })

      if (res.ok) {
        addHistory(target, trimmed, true)
        setMessage('')
        setStatus('已发送')
        setTimeout(() => setStatus(''), 2000)
      } else {
        const err = await res.json()
        addHistory(target, trimmed, false)
        setStatus(err.error || '发送失败')
        setTimeout(() => setStatus(''), 3000)
      }
    } catch {
      addHistory(target, trimmed, false)
      setStatus('网络错误，请检查服务端')
      setTimeout(() => setStatus(''), 3000)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="sender-page">
      <header className="sender-header">
        <h1>教室通知系统</h1>
        <div className="online-info">
          <span className="online-dot" />
          在线教室：{rooms.length > 0 ? rooms.join('、') : '无'}
        </div>
      </header>

      <main className="sender-main">
        <div className="compose-area">
          <div className="room-selector">
            <span className="label">发送到：</span>
            <button
              className={`room-tag ${selectedRoom === '__all__' || !selectedRoom ? 'active' : ''}`}
              onClick={() => setSelectedRoom('__all__')}
            >
              全部教室
            </button>
            {rooms.map((r) => (
              <button
                key={r}
                className={`room-tag ${selectedRoom === r ? 'active' : ''}`}
                onClick={() => setSelectedRoom(r)}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="input-row">
            <input
              ref={inputRef}
              type="text"
              className="message-input"
              placeholder="输入通知内容，按 Enter 发送..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={sending || !message.trim()}
            >
              {sending ? '发送中...' : '发送'}
            </button>
          </div>

          {status && <div className={`status-msg ${status === '已发送' ? 'ok' : 'err'}`}>{status}</div>}
        </div>

        {history.length > 0 && (
          <div className="history">
            <h2>发送记录</h2>
            <ul>
              {history.map((h) => (
                <li key={h.id} className={h.sent ? '' : 'failed'}>
                  <span className="h-time">{h.time}</span>
                  <span className="h-room">[{h.room}]</span>
                  <span className="h-msg">{h.message}</span>
                  {!h.sent && <span className="h-badge">失败</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
