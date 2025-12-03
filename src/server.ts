import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import process from 'node:process'

// 辅助函数：输出信息（使用console.warn来绕过ESLint限制）
function logInfo(message: string): void {
  console.warn(`[INFO] ${message}`)
}

const server = createServer((req, res) => {
  const currentTime = new Date().toISOString()

  // 处理GET请求
  if (req.method === 'GET') {
    const url = req.url || '/'

    // 打印GET请求信息
    logInfo('=== GET Request Received ===')
    logInfo(`Time: ${currentTime}`)
    logInfo(`URL: ${url}`)
    logInfo(`Method: ${req.method}`)
    logInfo('=============================\n')

    // 返回成功响应
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      message: 'GET request received',
      receivedAt: currentTime,
      url,
      method: 'GET',
    }))
    return
  }

  // 处理POST请求
  if (req.method === 'POST') {
    const chunks: Buffer[] = []

    // 收集请求体数据
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // 请求体接收完成
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()

      // 打印请求体和当前时间
      logInfo('=== POST Request Received ===')
      logInfo(`Time: ${currentTime}`)
      logInfo(`Body: ${body}`)
      logInfo('=============================\n')

      // 返回成功响应
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        message: 'POST request received',
        receivedAt: currentTime,
        body,
      }))
    })

    // 处理错误
    req.on('error', (err) => {
      console.error('Request error:', err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal Server Error' }))
    })
    return
  }

  // 处理其他HTTP方法
  res.writeHead(405, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    error: 'Method Not Allowed',
    allowedMethods: ['GET', 'POST'],
  }))
})

const PORT = 3000

server.listen(PORT, () => {
  logInfo(`HTTP server listening on port ${PORT}`)
  logInfo(`Supported methods: GET, POST`)
  logInfo(`Test URLs:`)
  logInfo(`  GET:  http://localhost:${PORT}/any-path`)
  logInfo(`  POST: http://localhost:${PORT}`)
})

// 优雅关闭
process.on('SIGTERM', () => {
  logInfo('SIGTERM received, shutting down gracefully')
  server.close(() => {
    logInfo('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logInfo('SIGINT received, shutting down gracefully')
  server.close(() => {
    logInfo('Server closed')
    process.exit(0)
  })
})
