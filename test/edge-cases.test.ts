import { describe, expect, it } from 'vitest'
import request from '../src/request'
import { getFutureTime, getTimeError, requestWithTimestamp } from './helpers/request'

describe('边界情况测试', () => {
  it('空请求体 - POST 请求', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      method: 'POST',
      body: '',
    })

    expect(response.statusCode).toBe(200)
  })

  it('超长请求头 - 大量 header', async () => {
    const longHeaders: Record<string, string> = {}
    for (let i = 0; i < 50; i++) {
      longHeaders[`X-Header-${i}`] = `x`.repeat(50)
    }

    const response = await request({
      host: 'localhost',
      port: 3000,
      headers: longHeaders,
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.headers['x-header-0']).toBeDefined()
  })

  it('大请求体 - 100KB 数据', async () => {
    const largeBody = 'x'.repeat(100 * 1024)

    const response = await request({
      host: 'localhost',
      port: 3000,
      method: 'POST',
      body: largeBody,
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.body.length).toBe(100 * 1024)
  })

  it('特殊字符 - Unicode 和 emoji', async () => {
    const specialBody = JSON.stringify({
      text: '你好 🎉 🚀',
      emoji: '😀🎊',
      unicode: '\u{1F600}',
    })

    const response = await request({
      host: 'localhost',
      port: 3000,
      method: 'POST',
      body: specialBody,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })

    expect(response.statusCode).toBe(200)
  })

  it('get 请求带 body - 应被忽略', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      method: 'GET',
      body: 'should be ignored',
    })

    expect(response.statusCode).toBe(200)
  })

  it('head 请求带 body - 应被忽略', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      method: 'HEAD',
      body: 'should be ignored',
    })

    expect(response.statusCode).toBe(200)
  })

  it('分块响应 - Transfer-Encoding: chunked', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '/chunked',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBeDefined()
    expect(response.body.length).toBeGreaterThan(0)
  })

  it('多个请求 - 并发', async () => {
    const promises = []
    for (let i = 0; i < 5; i++) {
      promises.push(request({
        host: 'localhost',
        port: 3000,
        path: `/test-${i}`,
      }))
    }

    const responses = await Promise.all(promises)
    responses.forEach((res) => {
      expect(res.statusCode).toBe(200)
    })
  })

  it('极短延迟 - 10ms 后发送', async () => {
    const targetTime = getFutureTime(10)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('中等延迟 - 500ms 后发送', async () => {
    const targetTime = getFutureTime(500)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('高延迟 - 1s 后发送', async () => {
    const targetTime = getFutureTime(1000)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('路径包含特殊字符', async () => {
    const specialPaths = [
      '/path/with/slashes',
      '/path?query=value&other=123',
      '/path#fragment',
    ]

    for (const path of specialPaths) {
      const response = await request({
        host: 'localhost',
        port: 3000,
        path,
      })

      expect(response.statusCode).toBe(200)
    }
  })

  it('请求头大小写混合', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value',
      },
    })

    expect(response.statusCode).toBe(200)
  })

  it('空路径 - 默认为 /', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '',
    })

    expect(response.statusCode).toBe(200)
  })

  it('延迟请求带大请求体', async () => {
    const targetTime = getFutureTime(100)
    const largeBody = 'x'.repeat(10 * 1024)

    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      method: 'POST',
      body: largeBody,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })
})
