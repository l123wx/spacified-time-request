import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { resolve } from 'node:path'

const tlsOptions = {
  key: readFileSync(resolve(__dirname, 'fixtures/tls/key.pem')),
  cert: readFileSync(resolve(__dirname, 'fixtures/tls/cert.pem')),
}

let httpServer: Server
let httpsServer: Server

function createRequestHandler(isSecure = false) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const bodyChunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      bodyChunks.push(chunk)
    })

    req.on('end', () => {
      const requestId = req.headers['x-request-id'] as string || `${isSecure ? 'https' : 'http'}-${Date.now()}-${Math.random()}`
      const url = req.url || '/'

      if (url === '/timeout') {
        return
      }

      if (url === '/close') {
        res.destroy()
        return
      }

      if (url === '/invalid') {
        res.write('This is not HTTP')
        res.end()
        return
      }

      if (url === '/empty') {
        res.end()
        return
      }

      if (url === '/chunked') {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Transfer-Encoding': 'chunked',
        })
        res.write('chunk1')
        setTimeout(() => res.write('chunk2'), 10)
        setTimeout(() => res.write('chunk3'), 20)
        setTimeout(() => res.end(), 30)
        return
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
      })
      res.end(JSON.stringify({
        success: true,
        requestId,
        receivedAt: Date.now(),
        method: req.method,
        path: url,
        headers: req.headers,
        body: Buffer.concat(bodyChunks).toString(),
        ...(isSecure ? { secure: true } : {}),
      }))
    })
  }
}

export default async function setup(): Promise<void> {
  httpServer = createServer(createRequestHandler(false))
  httpsServer = createHttpsServer(tlsOptions, createRequestHandler(true))

  await Promise.all([
    new Promise<void>((resolve) => {
      httpServer.listen(3000, () => {
        console.warn('HTTP test server listening on port 3000')
        resolve()
      })
    }),
    new Promise<void>((resolve) => {
      httpsServer.listen(3001, () => {
        console.warn('HTTPS test server listening on port 3001')
        resolve()
      })
    }),
  ])
}

export async function teardown(): Promise<void> {
  httpServer?.close()
  httpsServer?.close()
}
