import { describe, expect, it } from 'vitest'
import request, { doOnTargetTime } from '../src/request'
import { getFutureTime, getTimeError, requestWithTimestamp } from './helpers/request'

describe('时间精度测试', () => {
  it('无 targetTime - 立即发送请求', async () => {
    const startTime = Date.now()
    await request({
      host: 'localhost',
      port: 3000,
    })
    const endTime = Date.now()

    expect(endTime - startTime).toBeLessThan(100)
  })

  it('有 targetTime - 100ms 后发送 (±10ms)', async () => {
    const targetTime = getFutureTime(100)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('有 targetTime - 200ms 后发送 (±10ms)', async () => {
    const targetTime = getFutureTime(200)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('有 targetTime - 300ms 后发送 (±10ms)', async () => {
    const targetTime = getFutureTime(300)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('过去时间 - 立即发送', async () => {
    const pastTime = Date.now() - 1000
    const startTime = Date.now()

    await request({
      host: 'localhost',
      port: 3000,
      targetTime: pastTime,
    })

    const endTime = Date.now()
    expect(endTime - startTime).toBeLessThan(10)
  })

  it('带请求体的延迟请求', async () => {
    const targetTime = getFutureTime(150)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3000,
      method: 'POST',
      body: 'test data',
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('https 延迟请求', async () => {
    const targetTime = getFutureTime(120)
    const actualTime = await requestWithTimestamp({
      host: 'localhost',
      port: 3001,
      https: true,
      targetTime,
    })

    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('doOnTargetTime 函数精度 (±10ms)', async () => {
    const targetTime = getFutureTime(100)
    let actualTime = 0

    doOnTargetTime(() => {
      actualTime = Date.now()
    }, targetTime)

    await new Promise(resolve => setTimeout(resolve, 200))

    expect(actualTime).toBeGreaterThan(0)
    expect(getTimeError(targetTime, actualTime)).toBeLessThanOrEqual(10)
  })

  it('doOnTargetTime - Date 字符串格式', async () => {
    const targetDate = new Date(Date.now() + 100)
    let actualTime = 0

    doOnTargetTime(() => {
      actualTime = Date.now()
    }, targetDate.toISOString())

    await new Promise(resolve => setTimeout(resolve, 200))

    expect(actualTime).toBeGreaterThan(0)
  })

  it('doOnTargetTime - 时间戳格式', async () => {
    const targetTime = Date.now() + 100
    let actualTime = 0

    doOnTargetTime(() => {
      actualTime = Date.now()
    }, targetTime)

    await new Promise(resolve => setTimeout(resolve, 200))

    expect(actualTime).toBeGreaterThan(0)
  })
})
