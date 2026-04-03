import { describe, expect, it } from 'vitest'
import request from '../src/request'

describe('基本功能测试', () => {
  it('get 请求 - 成功响应', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '/test',
      method: 'GET',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/json')
    expect(response.body).toBeDefined()
  })

  it('post 请求 - 带请求体', async () => {
    const testData = { name: 'test', value: 123 }
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '/create',
      method: 'POST',
      body: JSON.stringify(testData),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.body).toContain('test')
  })

  it('https 请求 - TLS 连接', async () => {
    const response = await request({
      host: 'localhost',
      port: 3001,
      path: '/secure',
      https: true,
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.secure).toBe(true)
  })

  it('自定义请求头', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      headers: {
        'X-Custom-Header': 'custom-value',
        'Authorization': 'Bearer token',
      },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.headers['x-custom-header']).toBe('custom-value')
    expect(body.headers.authorization).toBe('Bearer token')
  })

  it('响应解析 - 包含所有字段', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '/full-response',
    })

    expect(response).toHaveProperty('statusCode')
    expect(response).toHaveProperty('statusText')
    expect(response).toHaveProperty('headers')
    expect(response).toHaveProperty('body')
  })

  it('head 请求', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      method: 'HEAD',
    })

    expect(response.statusCode).toBe(200)
  })

  it('不同路径', async () => {
    const paths = ['/', '/api/test', '/users/123', '/search?q=test']

    for (const path of paths) {
      const response = await request({
        host: 'localhost',
        port: 3000,
        path,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.path).toBe(path)
    }
  })
})
