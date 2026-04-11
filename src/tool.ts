import type { HttpResponse, TimeoutResult } from './connection'
import type { RequestOptions } from './request'
import { Connection } from './connection'

/**
 * 测试连接的服务器空闲超时时间
 *
 * @param conn - 已建立并可选调用过 prepare() 的连接
 * @returns 超时测试结果
 */
export function testTimeout(conn: Connection): Promise<TimeoutResult> {
  if (!conn.isAlive) {
    throw new Error('Connection is closed')
  }

  return new Promise<TimeoutResult>((resolve) => {
    const buildResult = (): TimeoutResult => {
      const now = Date.now()
      const result: TimeoutResult = {
        connectedMs: now - conn.createdAt,
      }
      if (conn.preparedAt != null) {
        result.preparedMs = now - conn.preparedAt
      }
      return result
    }

    conn.onceClose(() => resolve(buildResult()))
  })
}

/**
 * 便捷函数：测试指定接口的服务器空闲连接超时时间
 *
 * @param options - 请求配置（与 request() 相同，忽略 targetTime）
 * @returns 超时测试结果，包含连接保持时间和请求等待时间
 *
 * @example
 * ```ts
 * const result = await testConnectionTimeout({
 *   host: 'example.com',
 *   port: 443,
 *   https: true,
 *   method: 'POST',
 *   path: '/api/checkout',
 *   body: '{"item":"test"}',
 *   headers: { Authorization: 'Bearer token' },
 * })
 * console.log(`连接保持 ${result.connectedMs}ms，请求等待 ${result.preparedMs}ms`)
 * ```
 */
export async function testConnectionTimeout(options: RequestOptions): Promise<TimeoutResult> {
  const method = (options.method || 'GET').toUpperCase()
  const body = options.body || ''
  const isHasBody = !!body && method !== 'GET' && method !== 'HEAD'

  const conn = await Connection.connect(options.host, options.port, options.https)

  conn.prepare({
    method,
    path: options.path || '/',
    headers: { Host: options.host, ...options.headers },
    body: isHasBody ? body : '',
  })

  return testTimeout(conn)
}

export interface MinDataRateResult {
  /** 最大可等待时长（毫秒），超过此值服务器会超时 */
  maxWaitMs: number
  /** 使用的测试精度（毫秒） */
  precisionMs: number
  /** 测试次数 */
  iterations: number
  /** 最后一次成功测试时的响应状态码 */
  statusCode?: number
}

export interface MinDataRateOptions {
  /** 哪些状态码被认为是成功响应，默认 2xx */
  successStatusCodes?: number[]
  /** 单次测试的响应超时时间（毫秒），默认 5000ms */
  testTimeoutMs?: number
}

/**
 * 测试服务器对请求体数据速率的最小要求
 *
 * 使用二分查找找出从 prepare() 到 fire() 之间最大可等待时长。
 * 超过这个时长服务器会因 MinRequestBodyDataRate 等限制而拒绝请求。
 *
 * **注意**：此测试需要发送多次请求，可能会对服务器产生负载。
 *
 * @param requestOptions - 请求配置（必须有 body 的请求，否则无法测试数据速率）
 * @param maxWaitMs - 最大测试等待时间（毫秒），默认 5000ms
 * @param precisionMs - 测试精度（毫秒），默认 50ms
 * @param rateOptions - 额外的测试选项
 * @returns 数据速率测试结果
 *
 * @example
 * ```ts
 * const result = await testMinDataRate({
 *   host: 'localhost',
 *   port: 3000,
 *   method: 'POST',
 *   path: '/api/checkout',
 *   body: JSON.stringify({ item: 'test' }),
 * })
 * console.log(`最大可等待 ${result.maxWaitMs}ms，超过会超时（状态码: ${result.statusCode}）`)
 * ```
 */
export async function testMinDataRate(
  requestOptions: RequestOptions,
  maxWaitMs = 5000,
  precisionMs = 50,
  rateOptions: MinDataRateOptions = {},
): Promise<MinDataRateResult> {
  const {
    successStatusCodes = [],
    testTimeoutMs = 5000,
  } = rateOptions

  const method = (requestOptions.method || 'GET').toUpperCase()
  const body = requestOptions.body || ''
  const isHasBody = !!body && method !== 'GET' && method !== 'HEAD'

  if (!isHasBody) {
    throw new Error(`testMinDataRate requires a request with body, but ${method} requests have no body`)
  }

  // 判断状态码是否为成功
  const isSuccess = (statusCode: number): boolean => {
    if (successStatusCodes.length > 0) {
      return successStatusCodes.includes(statusCode)
    }
    return statusCode >= 200 && statusCode < 300
  }

  // 单次测试：等待指定时间后 fire，返回是否成功
  async function testWait(waitMs: number): Promise<{ success: boolean, statusCode?: number }> {
    const conn = await Connection.connect(requestOptions.host, requestOptions.port, requestOptions.https)

    conn.prepare({
      method,
      path: requestOptions.path || '/',
      headers: { Host: requestOptions.host, ...requestOptions.headers },
      body,
    })

    // 等待指定时间
    await new Promise<void>(resolve => setTimeout(resolve, waitMs))

    try {
      const req = conn.fire()
      // 等待响应或超时
      const response = await Promise.race<HttpResponse>([
        req,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), testTimeoutMs)),
      ])
      return { success: isSuccess(response.statusCode), statusCode: response.statusCode }
    }
    catch {
      // 连接断开或超时，确保清理
      conn.destroy()
      return { success: false, statusCode: undefined }
    }
  }

  // 先测试边界情况
  const testZero = await testWait(0)
  if (!testZero.success) {
    const statusInfo = testZero.statusCode !== undefined
      ? ` (status: ${testZero.statusCode})`
      : ''
    throw new Error(`Even 0ms wait failed, server may be rejecting requests${statusInfo}`)
  }

  // 二分查找最大可等待时间
  let low = 0
  let high = maxWaitMs
  let iterations = 0
  let lastSuccess = 0
  let lastStatusCode = testZero.statusCode

  while (high - low > precisionMs) {
    iterations++
    const mid = Math.floor((low + high) / 2)
    const result = await testWait(mid)

    if (result.success) {
      lastSuccess = mid
      lastStatusCode = result.statusCode
      low = mid
    }
    else {
      high = mid
    }

    // 避免无限循环
    if (iterations > 100) {
      break
    }
  }

  return {
    maxWaitMs: lastSuccess,
    precisionMs,
    iterations,
    statusCode: lastStatusCode,
  }
}
