import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { networkInterfaces } from 'os'
import { exec } from 'child_process'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const PORT = 3000
const SECRET_FILE = path.join(process.cwd(), 'secret.txt')

// Load or generate secret key
function getSecret(): string {
  if (existsSync(SECRET_FILE)) {
    return readFileSync(SECRET_FILE, 'utf-8').trim()
  }
  const secret = randomBytes(16).toString('hex')
  writeFileSync(SECRET_FILE, secret)
  return secret
}

const SECRET = getSecret()
const BANNED_ROOM_CHARS = /[<>:"/\\|?*'"`]/

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: ['http://localhost:3000', 'http://localhost:5173'] },
  maxHttpBufferSize: 5e6, // 5MB
  connectTimeout: 5000,
})

// ---- Rate limiter ----
const rateMap = new Map<string, { count: number; reset: number }>()
function checkRate(key: string, maxPerSec: number): boolean {
  const now = Date.now()
  const entry = rateMap.get(key) || { count: 0, reset: now + 1000 }
  if (now > entry.reset) {
    entry.count = 0
    entry.reset = now + 1000
  }
  entry.count++
  rateMap.set(key, entry)
  return entry.count <= maxPerSec
}
// Cleanup stale entries every 60s
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of rateMap) {
    if (now > v.reset + 5000) rateMap.delete(k)
  }
}, 60000)

// ---- Room tracking ----
const rooms = new Map<string, Set<string>>()

io.on('connection', (socket) => {
  const room = (socket.handshake.query.room as string) || ''
  const key = (socket.handshake.query.key as string) || ''

  // Auth check
  if (key !== SECRET) {
    console.log(`[拒绝] 密钥错误 (${socket.id})`)
    socket.emit('auth-error', '密钥错误，连接被拒绝')
    socket.disconnect()
    return
  }

  if (room) {
    // Validate room name
    if (room.length > 32 || BANNED_ROOM_CHARS.test(room)) {
      socket.disconnect()
      return
    }

    console.log(`[连接] 教室 "${room}" 上线 (${socket.id})`)
    if (!rooms.has(room)) rooms.set(room, new Set())
    rooms.get(room)!.add(socket.id)
    broadcastRoomList()

    socket.on('camera-frame', (data: { room: string; frame: string }) => {
      if (!checkRate('frame-' + socket.id, 5)) return
      // Only relay frames from authenticated receivers
      for (const [id, s] of io.sockets.sockets) {
        if (!s.handshake.query.room) s.emit('camera-frame', data)
      }
    })

    socket.on('disconnect', () => {
      console.log(`[断开] 教室 "${room}" 离线 (${socket.id})`)
      const set = rooms.get(room)
      if (set) {
        set.delete(socket.id)
        if (set.size === 0) rooms.delete(room)
      }
      broadcastRoomList()
    })
  } else {
    console.log(`[连接] 教师端上线 (${socket.id})`)

    socket.on('start-camera', (data: { room: string }) => {
      if (!checkRate('camera-' + socket.id, 2)) return
      if (rooms.has(data.room)) {
        for (const sid of rooms.get(data.room)!) io.to(sid).emit('start-camera', {})
        console.log(`[摄像头] 教师端请求查看 "${data.room}"`)
      }
    })

    socket.on('stop-camera', (data: { room: string }) => {
      if (rooms.has(data.room)) {
        for (const sid of rooms.get(data.room)!) io.to(sid).emit('stop-camera', {})
        console.log(`[摄像头] 教师端停止查看 "${data.room}"`)
      }
    })

    socket.on('disconnect', () => {
      console.log(`[断开] 教师端离线 (${socket.id})`)
    })
  }
})

function broadcastRoomList() {
  io.emit('room-list', Array.from(rooms.keys()))
}

// ---- HTTP API (auth required) ----
app.use(express.json({ limit: '1mb' }))

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.headers['x-auth-key'] as string || ''
  if (key !== SECRET) {
    res.status(401).json({ error: '未授权：密钥错误' })
    return
  }
  next()
}

app.use('/api', authMiddleware)

app.post('/api/send', (req, res) => {
  if (!checkRate('send', 10)) {
    res.status(429).json({ error: '发送过于频繁，请稍后再试' })
    return
  }
  const { room, rooms: roomsArr, message } = req.body
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: '消息不能为空' })
    return
  }
  if (message.length > 2000) {
    res.status(400).json({ error: '消息过长（最大2000字符）' })
    return
  }
  const targets: string[] = roomsArr && Array.isArray(roomsArr) ? roomsArr : room ? [room] : []
  const validTargets = targets.filter((t: string) => t.length <= 32 && !BANNED_ROOM_CHARS.test(t))
  if (validTargets.length === 0) {
    res.status(400).json({ error: '请选择教室' })
    return
  }

  let sentCount = 0
  for (const target of validTargets) {
    if (rooms.has(target)) {
      for (const sid of rooms.get(target)!) {
        io.to(sid).emit('notification', { from: '老师', message: message.trim() })
        sentCount++
      }
    }
  }
  console.log(`[发送] [${validTargets.join(', ')}] ← "${message.trim()}"`)
  res.json({ ok: true, sentTo: validTargets.length, messageCount: sentCount })
})

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: Array.from(rooms.keys()) })
})

app.get('/api/secret', (_req, res) => {
  // Only return secret via localhost for teacher setup
  const host = _req.hostname || _req.ip || ''
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1') {
    res.json({ secret: SECRET })
  } else {
    res.status(403).json({ error: '仅限本机访问' })
  }
})

// ---- Static ----
const distPath = path.join(process.cwd(), 'dist')
app.use(express.static(distPath))
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// ---- Startup ----
function getLocalIP(): string {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(cmd, () => {})
}

httpServer.listen(PORT, () => {
  const ip = getLocalIP()
  console.log('========================================')
  console.log('  师说 - 教室通知系统 v1.1.0')
  console.log('========================================')
  console.log(`  本机访问: http://localhost:${PORT}`)
  console.log(`  局域网IP: http://${ip}:${PORT}`)
  console.log(`  安全密钥: ${SECRET}`)
  console.log('')
  console.log('  ⚠️  请将密钥配置到教师端和教室端')
  console.log('========================================')
  openBrowser(`http://localhost:${PORT}`)
})
