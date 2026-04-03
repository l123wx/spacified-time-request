import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { Buffer } from 'node:buffer'
import net from 'node:net'
import tls from 'node:tls'
import { HTTPParser } from 'http-parser-js'

type Time = string | number | Date

const NO_CANCEL: () => void = () => {}
const HTTP_HEADER_END = '\r\n\r\n'

export interface RequestOptions {
  host: string
  port: number
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string
  targetTime?: Time
  https?: boolean
}

interface HttpResponse {
  statusCode: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export class CancellationError extends Error {
  constructor(message = 'Request cancelled') {
    super(message)
    this.name = 'CancellationError'
  }
}

interface CancelableRequest extends Promise<HttpResponse> {
  cancel: (reason?: string) => void
}

function request(_options: RequestOptions): CancelableRequest {
  const defaultOptions = {
    path: '/',
    method: 'GET',
    headers: {},
    body: '',
    https: false,
  }

  const options = {
    ...defaultOptions,
    ..._options,
    path: _options.path || '/',
  }

  const {
    port,
    host,
    headers,
    body,
    method,
    path,
    targetTime,
    https,
  } = options

  // 参数验证
  if (!host) {
    throw new Error('host is required')
  }
  if (typeof port !== 'number' || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}`)
  }

  const requestHeaders: Record<string, string> = {
    Host: host,
    Connection: 'close',
    accept: 'application/json',
    ...headers,
  }

  const isHasBodyRequest = !!body && method !== 'GET' && method !== 'HEAD'

  if (isHasBodyRequest) {
    requestHeaders['Content-Length'] = Buffer.byteLength(body).toString()
  }

  // 收集所有可取消的资源
  const cancelFns: (() => void)[] = []
  let cancelled = false

  const promise = connect(port, host, https).then((socket) => {
    if (cancelled) {
      socket.destroy()
      throw new CancellationError('Request cancelled before connection established')
    }

    // 注册 socket 销毁为取消动作
    cancelFns.push(() => socket.destroy())

    return new Promise<HttpResponse>((resolve, reject) => {
      const parser = new HTTPParser(HTTPParser.RESPONSE)
      const bodyChunks: Buffer[] = []
      let messageComplete = false

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
        result.body = bodyChunks.length > 0
          ? Buffer.concat(bodyChunks).toString()
          : ''
      }

      function cleanup(): void {
        socket.removeListener('data', onData)
        socket.removeListener('error', onError)
        socket.removeListener('close', onClose)
      }

      function onData(chunk: Buffer): void {
        if (cancelled)
          return
        try {
          parser.execute(chunk)
        }
        catch (err) {
          cleanup()
          socket.end()
          reject(new Error(`HTTP parser error: ${err}`))
          return
        }
        if (messageComplete) {
          cleanup()
          socket.end()
          resolve(result)
        }
      }

      function onError(err: Error): void {
        cleanup()
        if (cancelled) {
          reject(new CancellationError())
        }
        else {
          reject(err)
        }
      }

      function onClose(): void {
        cleanup()
        if (cancelled) {
          reject(new CancellationError())
          return
        }
        if (result.statusCode > 0) {
          if (!messageComplete) {
            result.body = bodyChunks.length > 0
              ? Buffer.concat(bodyChunks).toString()
              : ''
          }
          resolve(result)
        }
        else {
          reject(new Error('Connection closed with incomplete response'))
        }
      }

      socket.on('data', onData)
      socket.on('error', onError)
      socket.on('close', onClose)

      // 发送请求
      sendHeader(socket, { headers: requestHeaders, method, path }, isHasBodyRequest ? undefined : targetTime)
        .then(({ cancel: cancelHeader }) => {
          cancelFns.push(cancelHeader)
          if (cancelled)
            return
          if (isHasBodyRequest) {
            return sendBody(socket, body!, targetTime).then(({ cancel: cancelBody }) => {
              cancelFns.push(cancelBody)
            })
          }
        })
        .catch(reject)
    })
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

function connect(port: number, host: string, https = false): Promise<Socket | TLSSocket> {
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

async function sendHeader(
  socket: Socket,
  requestOptions: Pick<RequestOptions, 'headers' | 'method' | 'path'>,
  targetTime?: Time,
): Promise<{ cancel: () => void }> {
  const {
    headers = {},
    method,
    path,
  } = requestOptions

  const headerLines = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n')

  const requestLine = `${method} ${path} HTTP/1.1\r\n`
  const requestHead = `${requestLine + headerLines}`

  socket.write(requestHead)

  if (targetTime) {
    const cancel = doOnTargetTime(() => {
      socket.write(HTTP_HEADER_END)
    }, targetTime)
    return { cancel }
  }

  socket.write(HTTP_HEADER_END)
  return { cancel: NO_CANCEL }
}

function sendBody(socket: Socket, body: string, targetTime?: Time): Promise<{ cancel: () => void }> {
  const buffer = Buffer.from(body)
  const baseChunk = buffer.subarray(0, -1)
  const endChunk = buffer.subarray(-1)

  socket.write(baseChunk)

  if (targetTime) {
    const cancel = doOnTargetTime(() => {
      socket.write(endChunk)
    }, targetTime)
    return Promise.resolve({ cancel })
  }

  socket.write(endChunk)
  return Promise.resolve({ cancel: NO_CANCEL })
}

export function doOnTargetTime(callback: () => any, targetTime: Time): () => void {
  const targetMs = new Date(targetTime).getTime()
  const now = Date.now()

  // 如果目标时间已过，立即执行
  if (now >= targetMs) {
    callback()
    return NO_CANCEL
  }

  const delay = targetMs - now
  const earlyWake = Math.max(0, delay - 20)

  let timeoutId: NodeJS.Timeout | null = null
  let executed = false

  function execute(): void {
    if (executed)
      return
    executed = true
    while (Date.now() < targetMs) {
      // Busy wait until target time
    }
    callback()
  }

  if (earlyWake > 0) {
    timeoutId = setTimeout(execute, earlyWake)
  }
  else {
    execute()
  }

  // 返回取消函数
  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    executed = true
  }
}

export default request
