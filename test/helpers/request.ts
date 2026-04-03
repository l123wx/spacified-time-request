import type { RequestOptions } from '../../src/request'
import request from '../../src/request'

/**
 * 包装 request 函数，返回带时间戳的响应
 * 用于时间精度测试
 */
export async function requestWithTimestamp(options: RequestOptions & { requestId?: string }): Promise<number> {
  const requestId = options.requestId || `test-${Date.now()}-${Math.random()}`

  const response = await request({
    ...options,
    headers: {
      ...options.headers,
      'X-Request-ID': requestId,
    },
  })

  const body = JSON.parse(response.body)
  return body.receivedAt
}

/**
 * 等待指定毫秒数
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 生成测试用的未来时间点
 */
export function getFutureTime(ms: number): number {
  return Date.now() + ms
}

/**
 * 计算时间误差
 */
export function getTimeError(targetTime: number, actualTime: number): number {
  return Math.abs(actualTime - targetTime)
}
