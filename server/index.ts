import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { networkInterfaces } from 'os'
import { exec } from 'child_process'
import path from 'path'

const PORT = 3000

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8,
})

const rooms = new Map<string, Set<string>>()

io.on('connection', (socket) => {
  const room = socket.handshake.query.room as string | undefined

  if (room) {
    console.log(`[连接] 教室 "${room}" 上线 (${socket.id})`)
    if (!rooms.has(room)) rooms.set(room, new Set())
    rooms.get(room)!.add(socket.id)
    broadcastRoomList()

    socket.on('camera-frame', (data: { room: string; frame: string }) => {
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

app.post('/api/send', express.json(), (req, res) => {
  const { room, rooms: roomsArr, message } = req.body
  if (!message || !message.trim()) {
    res.status(400).json({ error: '消息不能为空' })
    return
  }
  const targets: string[] = roomsArr && Array.isArray(roomsArr) ? roomsArr : room ? [room] : []
  if (targets.length === 0) {
    res.status(400).json({ error: '请选择教室' })
    return
  }
  if (targets.includes('__all__')) {
    let sent = 0
    for (const [, sockets] of rooms) {
      for (const sid of sockets) {
        io.to(sid).emit('notification', { from: '老师', message: message.trim() })
        sent++
      }
    }
    console.log(`[发送] 全部教室 (${rooms.size}) ← "${message.trim()}"`)
    res.json({ ok: true, sentTo: rooms.size, messageCount: sent })
  } else {
    let sentCount = 0
    for (const target of targets) {
      if (rooms.has(target)) {
        for (const sid of rooms.get(target)!) {
          io.to(sid).emit('notification', { from: '老师', message: message.trim() })
          sentCount++
        }
      }
    }
    console.log(`[发送] [${targets.join(', ')}] ← "${message.trim()}"`)
    res.json({ ok: true, sentTo: targets.length, messageCount: sentCount })
  }
})

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: Array.from(rooms.keys()) })
})

const distPath = path.join(process.cwd(), 'dist')
app.use(express.static(distPath))
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

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
  console.log('  教室通知系统 - 服务端已启动')
  console.log('========================================')
  console.log(`  本机访问: http://localhost:${PORT}`)
  console.log(`  局域网IP: http://${ip}:${PORT}`)
  console.log('========================================')
  openBrowser(`http://localhost:${PORT}`)
})
