import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { networkInterfaces } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*' },
})

// Track connected rooms: roomName -> Set<socketId>
const rooms = new Map<string, Set<string>>()

io.on('connection', (socket) => {
  const room = socket.handshake.query.room as string | undefined

  if (!room) {
    socket.disconnect()
    return
  }

  console.log(`[连接] 教室 "${room}" 上线 (${socket.id})`)

  if (!rooms.has(room)) {
    rooms.set(room, new Set())
  }
  rooms.get(room)!.add(socket.id)

  broadcastRoomList()

  socket.on('disconnect', () => {
    console.log(`[断开] 教室 "${room}" 离线 (${socket.id})`)
    const roomSet = rooms.get(room)
    if (roomSet) {
      roomSet.delete(socket.id)
      if (roomSet.size === 0) {
        rooms.delete(room)
      }
    }
    broadcastRoomList()
  })
})

function broadcastRoomList() {
  const roomList = Array.from(rooms.keys())
  io.emit('room-list', roomList)
}

// API: send notification
app.post('/api/send', express.json(), (req, res) => {
  const { room, message } = req.body

  if (!message || !message.trim()) {
    res.status(400).json({ error: '消息不能为空' })
    return
  }

  if (room === '__all__') {
    let sent = 0
    for (const [, sockets] of rooms) {
      for (const sid of sockets) {
        io.to(sid).emit('notification', { from: '老师', message: message.trim() })
        sent++
      }
    }
    console.log(`[发送] 全部教室 (${rooms.size}个) ← "${message.trim()}"`)
    res.json({ ok: true, sentTo: rooms.size, messageCount: sent })
  } else if (rooms.has(room)) {
    const sockets = rooms.get(room)!
    for (const sid of sockets) {
      io.to(sid).emit('notification', { from: '老师', message: message.trim() })
    }
    console.log(`[发送] "${room}" ← "${message.trim()}"`)
    res.json({ ok: true, sentTo: 1 })
  } else {
    res.status(404).json({ error: `教室 "${room}" 不在线` })
  }
})

// API: get online rooms
app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: Array.from(rooms.keys()) })
})

// Serve static files: public/ first, then dist/
const distPath = path.resolve(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

function getLocalIP(): string {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return '127.0.0.1'
}

httpServer.listen(PORT, () => {
  const ip = getLocalIP()
  console.log('========================================')
  console.log('  教室通知系统 - 服务端已启动')
  console.log('========================================')
  console.log(`  本机访问: http://localhost:${PORT}`)
  console.log(`  局域网IP: http://${ip}:${PORT}`)
  console.log('')
  console.log('  教室电脑浏览器打开:')
  console.log(`  http://${ip}:${PORT}/display?room=1班`)
  console.log('========================================')
})
