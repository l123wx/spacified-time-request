import { describe, expect, it } from 'vitest'
import { Connection } from '../src/connection'
import { testTimeout } from '../src/index'
import request, { doOnTargetTime } from '../src/request'
import { getFutureTime, getTimeError } from './helpers/request'

describe('connection', () => {
  describe('connect()', () => {
    it('建立HTTP连接', async () => {
      const conn = await Connection.connect('localhost', 3000)
      expect(conn).toBeInstanceOf(Connection)
      expect(conn.isAlive).toBe(true)
      expect(conn.createdAt).toBeGreaterThan(0)
      conn.destroy()
    })

    it('建立HTTPS连接', async () => {
      const conn = await Connection.connect('localhost', 3001, true)
      expect(conn.isAlive).toBe(true)
      conn.destroy()
    })

    it('连接失败 - 无效端口', async () => {
      await expect(Connection.connect('localhost', 9999))
        .rejects
        .toThrow()
    })

    it('参数验证 - 无效host', async () => {
      await expect(Connection.connect('', 3000))
        .rejects
        .toThrow('host is required')
    })

    it('参数验证 - 无效port', async () => {
      await expect(Connection.connect('localhost', -1))
        .rejects
        .toThrow('Invalid port')
      await expect(Connection.connect('localhost', 99999))
        .rejects
        .toThrow('Invalid port')
    })
  })

  describe('prepare() + fire()', () => {
    it('gET请求 - 完整流程', async () => {
      const conn = await Connection.connect('localhost', 3000)
      conn.prepare({
        path: '/test',
        headers: { Host: 'localhost' },
      })
      const response = await conn.fire()
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('application/json')
    })

    it('pOST请求 - 带请求体', async () => {
      const conn = await Connection.connect('localhost', 3000)
      const body = JSON.stringify({ name: 'test' })
      conn.prepare({
        method: 'POST',
        path: '/create',
        headers: {
          'Host': 'localhost',
          'Content-Type': 'application/json',
        },
        body,
      })
      const response = await conn.fire()
      expect(response.statusCode).toBe(200)
      const parsed = JSON.parse(response.body)
      expect(parsed.body).toContain('test')
    })

    it('带 doOnTargetTime - 精确定时请求', async () => {
      const targetTime = getFutureTime(100)
      const conn = await Connection.connect('localhost', 3000)
      conn.prepare({
        path: '/test',
        headers: { 'Host': 'localhost', 'X-Request-ID': 'timing-test' },
      })
      await new Promise<void>(resolve => doOnTargetTime(resolve, targetTime))
      const response = await conn.fire()
      expect(response.statusCode).toBe(200)
      const parsed = JSON.parse(response.body)
      const actualTime = parsed.receivedAt
      expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
    })

    it('带 doOnTargetTime 的POST请求', async () => {
      const targetTime = getFutureTime(100)
      const body = JSON.stringify({ data: 'timed' })
      const conn = await Connection.connect('localhost', 3000)
      conn.prepare({
        method: 'POST',
        path: '/create',
        headers: {
          'Host': 'localhost',
          'Content-Type': 'application/json',
          'X-Request-ID': 'timing-post-test',
        },
        body,
      })
      await new Promise<void>(resolve => doOnTargetTime(resolve, targetTime))
      const response = await conn.fire()
      expect(response.statusCode).toBe(200)
      const parsed = JSON.parse(response.body)
      const actualTime = parsed.receivedAt
      expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
    })

    it('重复 prepare 应抛错', async () => {
      const conn = await Connection.connect('localhost', 3000)
      conn.prepare({ path: '/', headers: { Host: 'localhost' } })
      expect(() => conn.prepare({ path: '/', headers: { Host: 'localhost' } }))
        .toThrow('Request already prepared')
      conn.destroy()
    })

    it('未 prepare 直接 fire 应抛错', async () => {
      const conn = await Connection.connect('localhost', 3000)
      expect(() => conn.fire()).toThrow('Request not prepared')
      conn.destroy()
    })
  })

  describe('cancel', () => {
    it('取消请求', async () => {
      const conn = await Connection.connect('localhost', 3000)
      conn.prepare({
        path: '/test',
        headers: { Host: 'localhost' },
      })
      const req = conn.fire()
      req.cancel()
      await expect(req).rejects.toThrow()
      expect(conn.isAlive).toBe(false)
    })
  })

  describe('destroy()', () => {
    it('销毁连接', async () => {
      const conn = await Connection.connect('localhost', 3000)
      expect(conn.isAlive).toBe(true)
      conn.destroy()
      // 给 close 事件一点时间
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(conn.isAlive).toBe(false)
    })

    it('销毁后操作应抛错', async () => {
      const conn = await Connection.connect('localhost', 3000)
      conn.destroy()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(() => conn.prepare({ headers: { Host: 'localhost' } }))
        .toThrow('Connection is closed')
      expect(() => conn.fire()).toThrow('Connection is closed')
    })

    it('重复销毁不报错', async () => {
      const conn = await Connection.connect('localhost', 3000)
      conn.destroy()
      conn.destroy()
    })
  })

  describe('testTimeout()', () => {
    it('返回包含 connectedMs 和 preparedMs', async () => {
      const conn = await Connection.connect('localhost', 3000)
      conn.prepare({
        path: '/timeout',
        headers: { Host: 'localhost' },
      })

      // 手动触发关闭以避免等待服务器超时（实际使用中不需要）
      setTimeout(() => conn.destroy(), 100)
      const result = await testTimeout(conn)

      expect(result.connectedMs).toBeGreaterThan(0)
      expect(result.preparedMs).toBeGreaterThan(0)
      // preparedMs 应该 <= connectedMs
      expect(result.preparedMs!).toBeLessThanOrEqual(result.connectedMs)
    })

    it('不调用 prepare 时 preparedMs 为 undefined', async () => {
      const conn = await Connection.connect('localhost', 3000)
      setTimeout(() => conn.destroy(), 100)
      const result = await testTimeout(conn)
      expect(result.connectedMs).toBeGreaterThanOrEqual(90)
      expect(result.preparedMs).toBeUndefined()
    })
  })

  describe('与 request() 结果一致性', () => {
    it('gET请求结果一致', async () => {
      const connResponse = await (async () => {
        const conn = await Connection.connect('localhost', 3000)
        conn.prepare({
          path: '/test',
          headers: { Host: 'localhost' },
        })
        return conn.fire()
      })()

      const reqResponse = await request({
        host: 'localhost',
        port: 3000,
        path: '/test',
      })

      expect(connResponse.statusCode).toBe(reqResponse.statusCode)
      expect(connResponse.headers['content-type']).toBe(reqResponse.headers['content-type'])
    })

    it('pOST请求结果一致', async () => {
      const body = JSON.stringify({ test: 'compare' })

      const connResponse = await (async () => {
        const conn = await Connection.connect('localhost', 3000)
        conn.prepare({
          method: 'POST',
          path: '/create',
          headers: {
            'Host': 'localhost',
            'Content-Type': 'application/json',
          },
          body,
        })
        return conn.fire()
      })()

      const reqResponse = await request({
        host: 'localhost',
        port: 3000,
        method: 'POST',
        path: '/create',
        body,
      })

      expect(connResponse.statusCode).toBe(reqResponse.statusCode)
    })
  })

  describe('并发连接（预连接池场景）', () => {
    it('同时建立多个连接', async () => {
      const conns = await Promise.all([
        Connection.connect('localhost', 3000),
        Connection.connect('localhost', 3000),
        Connection.connect('localhost', 3000),
      ])

      expect(conns).toHaveLength(3)
      for (const conn of conns) {
        expect(conn.isAlive).toBe(true)
        conn.destroy()
      }
    })

    it('预连接池 - 建连 + prepare + fire', async () => {
      // 模拟预连接池场景：提前建连，稍后prepare和fire
      const pool = await Promise.all([
        Connection.connect('localhost', 3000),
        Connection.connect('localhost', 3000),
      ])

      // prepare
      for (const conn of pool) {
        conn.prepare({
          path: '/test',
          headers: { Host: 'localhost' },
        })
      }

      // fire
      const responses = await Promise.all(pool.map(conn => conn.fire()))
      for (const res of responses) {
        expect(res.statusCode).toBe(200)
      }
    })
  })
})
