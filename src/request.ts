import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { Buffer } from 'node:buffer'
import net from 'node:net'
import tls from 'node:tls'
import { HTTPParser } from 'http-parser-js'

type Time = string | number | Date

interface RequestOptions {
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

async function request(_options: RequestOptions): Promise<HttpResponse> {
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

  const socket = await connect(port, host, https)

  const requestHeaders: Record<string, string> = {
    Host: host,
    Connection: 'keep-alive',
    accept: 'application/json',
    ...headers,
  }

  const isHasBodyRequest = !!body && method !== 'GET' && method !== 'HEAD'

  if (isHasBodyRequest) {
    requestHeaders['Content-Length'] = Buffer.byteLength(body).toString()
  }

  return new Promise((resolve, reject) => {
    let responseData = Buffer.alloc(0)

    // 监听响应
    socket.on('data', (chunk: Buffer) => {
      responseData = Buffer.concat([responseData, chunk])
      resolve(parseResponse(responseData))
      // 暂时不考虑tcp 复用，所以请求完就关闭
      socket.end()
    })

    socket.on('error', reject)

    sendHeader(socket, { headers: requestHeaders, method, path }, isHasBodyRequest ? undefined : targetTime)
      .then(() => {
        // 如果有请求体，分块发送
        if (isHasBodyRequest) {
          // sendBodyInChunks(body, chunkSize, chunkDelay)
          sendBody(socket, body, targetTime)
        }
      })
  })
}

function connect(port: number, host: string, https = false): Promise<Socket | TLSSocket> {
  return new Promise<Socket | TLSSocket>((resolve, reject) => {
    if (https) {
      // HTTPS连接 - 使用TLS
      const socket = tls.connect({
        host,
        port,
        servername: host, // SNI支持
        rejectUnauthorized: false, // 允许自签名证书（生产环境应设为true）
      }, () => {
        console.warn(`已通过TLS连接到 ${host}:${port}`, new Date().toISOString())
        resolve(socket)
      })

      socket.on('error', reject)
      socket.setTimeout(30000) // 30秒超时
    }
    else {
      // HTTP连接 - 使用普通TCP
      const socket = net.createConnection(port, host, () => {
        console.warn(`已连接到 ${host}:${port}`, new Date().toISOString())
        resolve(socket)
      })

      socket.on('error', reject)
      socket.setTimeout(30000) // 30秒超时
    }
  })
}

async function sendHeader(
  socket: Socket,
  requestOptions: Pick<RequestOptions, 'headers' | 'method' | 'path'>,
  targetTime?: Time,
): Promise<void> {
  if (!socket) {
    return Promise.reject(new Error('Socket not connected'))
  }

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
  const emptyRow = '\r\n\r\n' // 当没有 Content-Length 时，传输空行即告诉服务端内容已经传输完毕

  socket.write(requestHead)
  console.warn('已发送基本请求头数据', new Date().toISOString())

  if (targetTime) {
    doOnTargetTime(() => {
      socket.write(emptyRow)
      console.warn('已发送头末尾数据', new Date().toISOString())
    }, targetTime)
  }
  else {
    socket.write(emptyRow)
  }
}

// 发送请求体
async function sendBody(socket: Socket, body: string, targetTime?: Time): Promise<void> {
  if (!socket) {
    throw new Error('Socket not connected')
  }

  const buffer = Buffer.from(body)

  const baseChunk = Uint8Array.prototype.slice.call(buffer, 0, buffer.length - 1)
  const endChunk = Uint8Array.prototype.slice.call(buffer, buffer.length - 1, buffer.length)

  console.warn('已发送基础 body 数据', new Date().toISOString())
  socket.write(baseChunk)

  if (targetTime) {
    doOnTargetTime(() => {
      socket.write(endChunk)
      console.warn('已发送末尾 body 数据', new Date().toUTCString())
    }, targetTime)
  }
  else {
    socket.write(endChunk)
  }
}

// 解析HTTP响应（使用http-parser-js库）
function parseResponse(rawResponse: Buffer): HttpResponse {
  const parser = new HTTPParser(HTTPParser.RESPONSE)

  const response: {
    statusCode: number
    statusText: string
    headers: Record<string, string>
    bodyChunks: Buffer[]
    body?: string
  } = {
    statusCode: 0,
    statusText: '',
    headers: {},
    bodyChunks: [],
  }

  // 设置解析器回调
  parser[HTTPParser.kOnHeadersComplete] = (info: any) => {
    response.statusCode = info.statusCode
    response.statusText = info.statusMessage || ''

    // 解析头部
    for (let i = 0; i < info.headers.length; i += 2) {
      const key = info.headers[i].toLowerCase()
      const value = info.headers[i + 1]
      response.headers[key] = value
    }
  }

  parser[HTTPParser.kOnBody] = (chunk: Buffer, offset: number, length: number) => {
    response.bodyChunks.push(chunk.subarray(offset, offset + length))
  }

  parser[HTTPParser.kOnMessageComplete] = () => {
    // 所有body chunk已接收
    if (response.bodyChunks.length > 0) {
      response.body = Buffer.concat(response.bodyChunks).toString()
    }
    else {
      response.body = ''
    }
  }

  try {
    // 执行解析
    const parseResult = parser.execute(rawResponse)
    parser.finish()

    // 检查解析结果
    if (parseResult instanceof Error) {
      throw parseResult
    }

    const bytesParsed = parseResult as number

    // 检查是否解析成功
    if (bytesParsed < rawResponse.length) {
      console.warn(`警告：只解析了 ${bytesParsed} 字节中的 ${rawResponse.length} 字节`)
    }

    if (response.statusCode === 0) {
      throw new Error('无法解析HTTP响应状态码')
    }
  }
  catch (error) {
    // 如果解析失败，回退到简单解析
    console.warn('http-parser-js解析失败:', error)
  }

  return {
    statusCode: response.statusCode,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body || '',
  }
}

export function doOnTargetTime(callback: () => any, targetTime: Time): void {
  const targetTimeNumber = new Date(targetTime).getTime()

  const timeout: NodeJS.Timeout = setInterval(() => {
    if (Date.now() >= targetTimeNumber) {
      callback()
      clearInterval(timeout)
    }
  }, 1)
}

export default request
