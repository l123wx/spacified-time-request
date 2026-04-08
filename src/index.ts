import type { TimeoutResult } from './connection'
import type { RequestOptions } from './request'
import { Connection } from './connection'
import request from './request'

export default request

export { Connection } from './connection'
export type { ConnectOptions, RequestInit, TimeoutResult } from './connection'
export { CancellationError } from './connection'
export type { RequestOptions, Time } from './request'
export { doOnTargetTime } from './request'

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
