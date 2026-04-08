import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { Buffer } from 'node:buffer'
import net from 'node:net'
import tls from 'node:tls'
import { HTTPParser } from 'http-parser-js'

const HTTP_HEADER_END = '\r\n\r\n'

export interface ConnectOptions {
  host: string
  port: number
  https?: boolean
}

export interface RequestInit {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  statusCode: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface TimeoutResult {
  /** 从连接建立到关闭的总时间（提前建连能保持多久） */
  connectedMs: number
  /** 从 prepare() 到关闭的时间（服务器等待完整请求多久，更关键） */
  preparedMs?: number
}

export class CancellationError extends Error {
  constructor(message = 'Request cancelled') {
    super(message)
    this.name = 'CancellationError'
  }
}

export interface CancelableRequest extends Promise<HttpResponse> {
  cancel: (reason?: string) => void
}

function connectSocket(port: number, host: string, https = false): Promise<Socket | TLSSocket> {
  return new Promise<Socket | TLSSocket>((resolve, reject) => {
    let socket: Socket | TLSSocket
    let resolved = false

    function onConnect(): void {
      if (resolved)
        return
      resolved = true
      socket.off('error', onError)
      socket.off('timeout', onTimeout)
      resolve(socket)
    }

    function onError(err: Error): void {
      if (resolved)
        return
      resolved = true
      socket.off('connect', onConnect)
      socket.off('timeout', onTimeout)
      reject(err)
    }

    function onTimeout(): void {
      socket.destroy()
      if (resolved)
        return
      resolved = true
      socket.off('connect', onConnect)
      socket.off('error', onError)
      reject(new Error('Connection timeout'))
    }

    if (https) {
      socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
      }, onConnect)
    }
    else {
      socket = net.createConnection(port, host, onConnect)
    }

    socket.once('error', onError)
    socket.once('timeout', onTimeout)
    socket.setTimeout(30000)
  })
}

export class Connection {
  private socket: Socket | TLSSocket
  private _alive = true
  private trigger: Buffer | string | null = null
  readonly createdAt: number
  private _preparedAt: number | null = null

  get preparedAt(): number | null {
    return this._preparedAt
  }

  private constructor(socket: Socket | TLSSocket) {
    this.socket = socket
    this.createdAt = Date.now()
    socket.once('close', () => {
      this._alive = false
    })
  }

  static async connect(host: string, port: number, https = false): Promise<Connection> {
    if (!host) {
      throw new Error('host is required')
    }
    if (typeof port !== 'number' || port < 0 || port > 65535) {
      throw new Error(`Invalid port: ${port}`)
    }
    const socket = await connectSocket(port, host, https)
    return new Connection(socket)
  }

  get isAlive(): boolean {
    return this._alive
  }

  prepare(options: RequestInit): void {
    if (!this._alive) {
      throw new Error('Connection is closed')
    }
    if (this.trigger !== null) {
      throw new Error('Request already prepared')
    }

    const method = (options.method || 'GET').toUpperCase()
    const path = options.path || '/'
    const headers = options.headers || {}
    const body = options.body || ''
    const isHasBody = !!body && method !== 'GET' && method !== 'HEAD'

    // 构建请求头
    const requestHeaders: Record<string, string> = {
      Host: headers.Host || headers.host || '',
      Connection: 'close',
      accept: 'application/json',
      ...headers,
    }

    if (isHasBody) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body).toString()
    }

    // 构建请求行 + 头部（不含 \r\n\r\n）
    const headerLines = Object.entries(requestHeaders)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n')

    const requestLine = `${method} ${path} HTTP/1.1\r\n`

    if (isHasBody) {
      // 有 body：一次性发送头部 + \r\n\r\n + body 减去最后一个字节
      const buffer = Buffer.from(body)
      this.socket.write(Buffer.concat([
        Buffer.from(requestLine + headerLines + HTTP_HEADER_END),
        buffer.subarray(0, -1),
      ]))
      this.trigger = buffer.subarray(-1)
    }
    else {
      this.socket.write(requestLine + headerLines)
      // 无 body：触发数据是 \r\n\r\n
      this.trigger = HTTP_HEADER_END
    }

    // 移除连接超时限制，让服务器决定何时断开
    this.socket.setTimeout(0)
    this._preparedAt = Date.now()
  }

  fire(): CancelableRequest {
    if (!this._alive) {
      throw new Error('Connection is closed')
    }
    if (this.trigger === null) {
      throw new Error('Request not prepared')
    }

    const triggerData = this.trigger
    this.trigger = null

    let cancelled = false
    const cancelFns: (() => void)[] = []

    cancelFns.push(() => this.socket.destroy())

    const promise = new Promise<HttpResponse>((resolve, reject) => {
      const parser = new HTTPParser(HTTPParser.RESPONSE)
      const bodyChunks: Buffer[] = []
      let messageComplete = false

      const buildBody = (): string =>
        bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString() : ''

      const result: HttpResponse = {
        statusCode: 0,
        statusText: '',
        headers: {},
        body: '',
      }

      parser[HTTPParser.kOnHeadersComplete] = (info: { statusCode: number, statusMessage: string, headers: string[] }) => {
        result.statusCode = info.statusCode
        result.statusText = info.statusMessage || ''
        for (let i = 0; i < info.headers.length; i += 2) {
          const key = info.headers[i].toLowerCase()
          const value = info.headers[i + 1]
          result.headers[key] = value
        }
      }

      parser[HTTPParser.kOnBody] = (chunk: Buffer, offset: number, length: number) => {
        bodyChunks.push(chunk.subarray(offset, offset + length))
      }

      parser[HTTPParser.kOnMessageComplete] = () => {
        messageComplete = true
        result.body = buildBody()
      }

      let cleanup: () => void

      const onData = (chunk: Buffer): void => {
        if (cancelled)
          return
        try {
          parser.execute(chunk)
        }
        catch (err) {
          cleanup()
          this.socket.destroy()
          reject(new Error(`HTTP parser error: ${err}`))
          return
        }
        if (messageComplete) {
          cleanup()
          this.socket.destroy()
          resolve(result)
        }
      }

      const onError = (err: Error): void => {
        cleanup()
        if (cancelled) {
          reject(new CancellationError())
        }
        else {
          reject(err)
        }
      }

      const onClose = (): void => {
        cleanup()
        if (cancelled) {
          reject(new CancellationError())
          return
        }
        if (result.statusCode > 0) {
          if (!messageComplete) {
            result.body = buildBody()
          }
          resolve(result)
        }
        else {
          reject(new Error('Connection closed with incomplete response'))
        }
      }

      cleanup = (): void => {
        this.socket.removeListener('data', onData)
        this.socket.removeListener('error', onError)
        this.socket.removeListener('close', onClose)
      }

      this.socket.on('data', onData)
      this.socket.on('error', onError)
      this.socket.on('close', onClose)

      // 立即发送触发数据
      this.socket.write(triggerData)
    }) as CancelableRequest

    promise.cancel = () => {
      if (cancelled)
        return
      cancelled = true
      for (const fn of cancelFns) {
        try {
          fn()
        }
        catch (err) {
          console.error('Error during cancellation:', err)
        }
      }
      cancelFns.length = 0
    }

    return promise
  }

  onceClose(fn: () => void): void {
    if (!this._alive) {
      fn()
    }
    else {
      this.socket.once('close', fn)
    }
  }

  destroy(): void {
    if (this._alive) {
      this.socket.destroy()
    }
  }
}
