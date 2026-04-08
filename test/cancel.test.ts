import { describe, expect, it } from 'vitest'
import { CancellationError } from '../src/connection'
import request, { doOnTargetTime } from '../src/request'

describe('取消控制测试', () => {
  it('cancel - 取消延迟请求', async () => {
    const req = request({
      host: 'localhost',
      port: 3000,
      targetTime: Date.now() + 5000, // 5秒后
    }) as ReturnType<typeof request> & { cancel: (reason?: string) => void }

    // 立即取消
    req.cancel()

    await expect(req).rejects.toThrow()
  })

  it('cancel - 取消时抛出 CancellationError', async () => {
    const req = request({
      host: 'localhost',
      port: 3000,
      targetTime: Date.now() + 5000,
    }) as ReturnType<typeof request> & { cancel: (reason?: string) => void }

    req.cancel()

    await expect(req).rejects.toThrow(CancellationError)
  })

  it('cancel - 重复调用 cancel 不报错', async () => {
    const req = request({
      host: 'localhost',
      port: 3000,
      targetTime: Date.now() + 5000,
    }) as ReturnType<typeof request> & { cancel: (reason?: string) => void }

    req.cancel()
    req.cancel()
    req.cancel()

    await expect(req).rejects.toThrow()
  })

  it('cancel - 取消未延迟的请求', async () => {
    const req = request({
      host: 'localhost',
      port: 3000,
    }) as ReturnType<typeof request> & { cancel: (reason?: string) => void }

    // 尝试取消（请求可能已经完成）
    req.cancel()

    // 即使取消，如果请求已经完成也应该正常返回
    const result = await req.catch(err => err)
    expect(result).toBeDefined()
  })

  it('doOnTargetTime - 返回取消函数', () => {
    let called = false
    const cancel = doOnTargetTime(() => {
      called = true
    }, Date.now() + 1000)

    expect(cancel).toBeTypeOf('function')
    cancel()

    // 等一下确认回调未执行
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(called).toBe(false)
        resolve()
      }, 200)
    })
  })

  it('doOnTargetTime - 取消后回调不执行', async () => {
    let called = false
    const cancel = doOnTargetTime(() => {
      called = true
    }, Date.now() + 200)

    // 100ms 后取消
    setTimeout(cancel, 100)

    // 等到超过目标时间后验证
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(called).toBe(false)
  })
})
