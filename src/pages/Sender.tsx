import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

const STORAGE_KEY = 'tongzi-classrooms'
const SECRET_KEY = 'tongzi-secret'

interface HistoryItem {
  id: number
  rooms: string
  message: string
  time: string
  sent: boolean
}

function loadClassrooms(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0) return arr
    }
  } catch {}
  return []
}

function saveClassrooms(list: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export default function Sender() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [onlineRooms, setOnlineRooms] = useState<string[]>([])
  const [configuredRooms, setConfiguredRooms] = useState<string[]>(loadClassrooms)
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set())
  const [newRoomName, setNewRoomName] = useState('')
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const historyId = useRef(0)

  // Camera
  const [cameraRoom, setCameraRoom] = useState<string | null>(null)
  const [cameraFrame, setCameraFrame] = useState<string | null>(null)
  const cameraFrameRef = useRef<string | null>(null)

  // Edit & Delete
  const [editingRoom, setEditingRoom] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Auth
  const [secret, setSecret] = useState(() => localStorage.getItem(SECRET_KEY) || '')
  const [showSecretInput, setShowSecretInput] = useState(!localStorage.getItem(SECRET_KEY))
  const [secretInput, setSecretInput] = useState('')
  const [authError, setAuthError] = useState('')

  // Persist classrooms
  useEffect(() => { saveClassrooms(configuredRooms) }, [configuredRooms])
  useEffect(() => { if (editingRoom) editInputRef.current?.focus() }, [editingRoom])

  // Socket
  useEffect(() => {
    if (!secret) return
    const s = io('/', {
      transports: ['websocket', 'polling'],
      query: { key: secret },
    })
    setSocket(s)

    s.on('room-list', (list: string[]) => setOnlineRooms(list))
    s.on('connect', () => {
      setAuthError('')
      fetch('/api/rooms', { headers: { 'x-auth-key': secret } })
        .then((r) => r.json())
        .then((data) => setOnlineRooms(data.rooms))
        .catch(() => {})
    })
    s.on('auth-error', (msg: string) => {
      setAuthError(msg)
      s.disconnect()
    })
    s.on('camera-frame', (data: { room: string; frame: string }) => {
      if (cameraFrameRef.current === data.room) setCameraFrame(data.frame)
    })

    return () => { s.disconnect() }
  }, [secret])

  useEffect(() => { inputRef.current?.focus() }, [])

  function saveSecret() {
    const val = secretInput.trim()
    if (!val) return
    localStorage.setItem(SECRET_KEY, val)
    setSecret(val)
    setShowSecretInput(false)
    setAuthError('')
  }

  // ---- camera ----
  function openCamera(room: string) {
    if (cameraRoom === room) { closeCamera(); return }
    closeCamera()
    cameraFrameRef.current = room
    setCameraRoom(room)
    setCameraFrame(null)
    socket?.emit('start-camera', { room })
  }
  function closeCamera() {
    if (cameraRoom) socket?.emit('stop-camera', { room: cameraRoom })
    cameraFrameRef.current = null
    setCameraRoom(null)
    setCameraFrame(null)
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && cameraRoom) closeCamera()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cameraRoom])

  // ---- classroom management ----
  function addClassroom() {
    const name = newRoomName.trim()
    if (!name || configuredRooms.includes(name)) return
    setConfiguredRooms((prev) => [...prev, name])
    setNewRoomName('')
  }
  function startEdit(name: string) { setEditingRoom(name); setEditValue(name); setConfirmDelete(null) }
  function saveEdit(oldName: string) {
    const newName = editValue.trim()
    if (!newName || newName === oldName || configuredRooms.includes(newName)) { setEditingRoom(null); return }
    setConfiguredRooms((prev) => prev.map((r) => (r === oldName ? newName : r)))
    setSelectedRooms((prev) => { const n = new Set(prev); if (n.has(oldName)) { n.delete(oldName); n.add(newName) } return n })
    if (cameraRoom === oldName) closeCamera()
    setEditingRoom(null)
  }
  function cancelEdit() { setEditingRoom(null); setEditValue('') }
  function requestDelete(name: string) { setConfirmDelete(name); setEditingRoom(null) }
  function confirmDeleteRoom(name: string) {
    setConfiguredRooms((prev) => prev.filter((r) => r !== name))
    setSelectedRooms((prev) => { const n = new Set(prev); n.delete(name); return n })
    if (cameraRoom === name) closeCamera()
    setConfirmDelete(null)
  }
  function cancelDelete() { setConfirmDelete(null) }
  function toggleRoom(name: string) {
    setSelectedRooms((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function selectAll() {
    if (selectedRooms.size === configuredRooms.length && configuredRooms.length > 0) setSelectedRooms(new Set())
    else setSelectedRooms(new Set(configuredRooms))
  }

  // ---- send ----
  function addHistory(roomLabel: string, msg: string, sent: boolean) {
    setHistory((prev) => [{
      id: ++historyId.current,
      rooms: roomLabel, message: msg,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      sent,
    }, ...prev].slice(0, 50))
  }
  async function handleSend() {
    const trimmed = message.trim()
    if (!trimmed) return
    const targets = Array.from(selectedRooms)
    if (targets.length === 0) return
    setSending(true); setStatus('')
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-key': secret },
        body: JSON.stringify({ rooms: targets, message: trimmed }),
      })
      if (res.ok) {
        addHistory(targets.join('、'), trimmed, true)
        setMessage(''); setStatus('已发送')
        setTimeout(() => setStatus(''), 2000)
      } else {
        const err = await res.json()
        addHistory(targets.join('、'), trimmed, false)
        setStatus(err.error || '发送失败')
        setTimeout(() => setStatus(''), 3000)
      }
    } catch {
      addHistory(targets.join('、'), trimmed, false)
      setStatus('网络错误')
      setTimeout(() => setStatus(''), 3000)
    } finally { setSending(false); inputRef.current?.focus() }
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const allSelected = configuredRooms.length > 0 && selectedRooms.size === configuredRooms.length

  // Secret key prompt
  if (showSecretInput) {
    return (
      <div className="sender-page">
        <div style={{ maxWidth: 440, margin: '120px auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: 26, marginBottom: 12 }}>🔐 输入安全密钥</h1>
          <p style={{ color: '#888', marginBottom: 24, fontSize: 14 }}>
            请查看教师端启动时的控制台输出，输入显示的密钥
          </p>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveSecret() }}
            placeholder="32位十六进制密钥"
            style={{
              width: '100%', padding: '12px 16px', border: '1.5px solid #ddd',
              borderRadius: 8, fontSize: 16, outline: 'none', textAlign: 'center',
              fontFamily: 'monospace', letterSpacing: 2,
            }}
            autoFocus
          />
          <button
            onClick={saveSecret}
            disabled={!secretInput.trim()}
            style={{
              marginTop: 16, padding: '12px 40px', background: '#4caf50', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 16, cursor: 'pointer',
            }}
          >
            确认
          </button>
          {authError && <p style={{ color: '#e53935', marginTop: 12, fontSize: 13 }}>{authError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="sender-page">
      <header className="sender-header">
        <h1>师说 · 教室通知系统</h1>
        <div className="online-info">
          <span className="online-dot" />
          在线教室：{onlineRooms.length > 0 ? onlineRooms.join('、') : '无'}
        </div>
      </header>

      <main className="sender-main">
        <section className="classroom-panel">
          <div className="panel-header">
            <h2>教室管理</h2>
            <span className="panel-hint">{configuredRooms.length} 个班级 · {onlineRooms.length} 个在线</span>
            {configuredRooms.length > 0 && (
              <button className="select-all-btn" onClick={selectAll}>
                {allSelected ? '取消全选' : '全选'}
              </button>
            )}
          </div>

          <div className="add-room-row">
            <input type="text" className="add-room-input" placeholder="输入班级名称，如：1班"
              value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addClassroom() }} />
            <button className="add-room-btn" onClick={addClassroom} disabled={!newRoomName.trim()}>
              + 添加班级
            </button>
          </div>

          {configuredRooms.length > 0 && (
            <div className="room-table">
              {configuredRooms.map((name) => {
                const online = onlineRooms.includes(name)
                const checked = selectedRooms.has(name)
                const viewing = cameraRoom === name
                const isEditing = editingRoom === name
                const isDeleting = confirmDelete === name
                return (
                  <div key={name} className={`room-row ${checked ? 'checked' : ''} ${viewing ? 'viewing' : ''} ${isEditing ? 'editing' : ''} ${isDeleting ? 'deleting' : ''}`}>
                    {isEditing ? (
                      <>
                        <input type="checkbox" checked={checked} disabled className="room-check" />
                        <input ref={editInputRef} className="edit-input" value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(name); if (e.key === 'Escape') cancelEdit() }} />
                        <button className="icon-btn confirm" onClick={() => saveEdit(name)} title="保存">✓</button>
                        <button className="icon-btn cancel" onClick={cancelEdit} title="取消">✕</button>
                      </>
                    ) : isDeleting ? (
                      <>
                        <input type="checkbox" checked={checked} disabled className="room-check" />
                        <span className="delete-msg">确定删除「{name}」？</span>
                        <button className="icon-btn danger" onClick={() => confirmDeleteRoom(name)} title="确认删除">✓</button>
                        <button className="icon-btn cancel" onClick={cancelDelete} title="取消">✕</button>
                      </>
                    ) : (
                      <>
                        <input type="checkbox" className="room-check" checked={checked} onChange={() => toggleRoom(name)} />
                        <span className="room-emoji">🏫</span>
                        <span className="room-name">{name}</span>
                        <span className={`room-badge ${online ? 'on' : 'off'}`}>{online ? '在线' : '离线'}</span>
                        <span className="room-actions">
                          <button className={`icon-btn ${online ? (viewing ? 'danger' : 'camera') : 'camera-off'}`}
                            onClick={() => online ? openCamera(name) : null}
                            title={online ? (viewing ? '停止查看' : '查看教室摄像头') : '教室离线，无法查看'}
                            disabled={!online}>{viewing ? '⏹' : '📷'}</button>
                          <button className="icon-btn edit" onClick={() => startEdit(name)} title="重命名">✏️</button>
                          <button className="icon-btn del" onClick={() => requestDelete(name)} title="删除">🗑️</button>
                        </span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {configuredRooms.length === 0 && <div className="empty-hint">尚未添加教室，请在上方输入班级名称并添加</div>}
          {configuredRooms.length > 0 && (
            <div className="selected-bar">
              <span>已选 {selectedRooms.size}/{configuredRooms.length} 个教室</span>
              <span>· 消息将发送至勾选的班级</span>
            </div>
          )}
        </section>

        {cameraRoom && (
          <section className="camera-panel">
            <div className="camera-header">
              <span className="camera-label">📷 {cameraRoom} — 实时画面</span>
              <span className="camera-hint">教室端无提醒 · 按 Esc 关闭</span>
              <button className="camera-close" onClick={closeCamera}>关闭 ✕</button>
            </div>
            <div className="camera-view">
              {cameraFrame ? <img src={cameraFrame} alt={cameraRoom + '教室画面'} className="camera-img" /> :
                <div className="camera-loading"><div className="camera-spinner" />正在获取摄像头画面...</div>}
            </div>
          </section>
        )}

        <section className="compose-area">
          <div className="input-row">
            <input ref={inputRef} type="text" className="message-input"
              placeholder="输入通知内容，按 Enter 发送..."
              value={message} onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown} disabled={sending} />
            <button className="send-btn" onClick={handleSend}
              disabled={sending || !message.trim() || selectedRooms.size === 0}>
              发送{selectedRooms.size > 0 ? ` (${selectedRooms.size}班)` : ''}
            </button>
          </div>
          {status && <div className={`status-msg ${status === '已发送' ? 'ok' : 'err'}`}>{status}</div>}
        </section>

        {history.length > 0 && (
          <section className="history">
            <h2>发送记录</h2>
            <ul>
              {history.map((h) => (
                <li key={h.id} className={h.sent ? '' : 'failed'}>
                  <span className="h-time">{h.time}</span>
                  <span className="h-room">[{h.rooms}]</span>
                  <span className="h-msg">{h.message}</span>
                  {!h.sent && <span className="h-badge">失败</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
