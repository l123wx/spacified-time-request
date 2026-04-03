import { describe, expect, it } from 'vitest'
import request from '../src/request'

describe('错误处理测试', () => {
  it('连接拒绝 - 服务器未启动', async () => {
    await expect(request({
      host: 'localhost',
      port: 9999,
    })).rejects.toThrow()
  })

  it('dNS 解析失败 - 无效主机', async () => {
    await expect(request({
      host: 'this-host-definitely-does-not-exist-12345.com',
      port: 80,
    })).rejects.toThrow()
  })

  it('socket 错误 - 连接中断', { timeout: 10000 }, async () => {
    await expect(request({
      host: 'localhost',
      port: 3000,
      path: '/close',
    })).rejects.toThrow()
  })

  it('无效响应 - 非 HTTP 格式', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '/invalid',
    })

    expect(response).toBeDefined()
  })

  it('空响应 - 服务器返回空数据', async () => {
    const response = await request({
      host: 'localhost',
      port: 3000,
      path: '/empty',
    })

    expect(response).toBeDefined()
  })

  it('无效端口 - 负数', () => {
    expect(() => request({
      host: 'localhost',
      port: -1,
    } as any)).toThrow()
  })

  it('无效端口 - 超过范围', () => {
    expect(() => request({
      host: 'localhost',
      port: 99999,
    } as any)).toThrow()
  })

  it('空主机名', () => {
    expect(() => request({
      host: '',
      port: 80,
    } as any)).toThrow()
  })

  it('hTTPS 证书错误 - 当前允许自签名证书', async () => {
    const response = await request({
      host: 'localhost',
      port: 3001,
      https: true,
    })

    expect(response.statusCode).toBe(200)
  })
})
