import type { CancelableRequest, HttpResponse } from './connection'
import { CancellationError, Connection } from './connection'

export type Time = string | number | Date

export interface RequestOptions {
  host: string
  port: number
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string
  targetTime?: Time
  https?: boolean
}

const NO_CANCEL: () => void = () => {}

export function doOnTargetTime(callback: () => any, targetTime: Time): () => void {
  const targetMs = new Date(targetTime).getTime()
  const now = Date.now()

  if (now >= targetMs) {
    callback()
    return NO_CANCEL
  }

  const delay = targetMs - now
  const earlyWake = Math.max(0, delay - 20)

  let timeoutId: NodeJS.Timeout | null = null
  let executed = false

  function execute(): void {
    if (executed)
      return
    executed = true
    while (Date.now() < targetMs) {
      // Busy wait until target time
    }
    callback()
  }

  if (earlyWake > 0) {
    timeoutId = setTimeout(execute, earlyWake)
  }
  else {
    execute()
  }

  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    executed = true
  }
}

function request(_options: RequestOptions): CancelableRequest {
  const {
    port,
    host,
    headers = {},
    body = '',
    method = 'GET',
    path = '/',
    targetTime,
    https = false,
  } = _options

  // 同步参数验证（保持向后兼容：同步抛错）
  if (!host) {
    throw new Error('host is required')
  }
  if (typeof port !== 'number' || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}`)
  }

  // 收集所有可取消的资源
  const cancelFns: (() => void)[] = []
  let cancelled = false

  const promise = Connection.connect(host, port, https).then((conn) => {
    if (cancelled) {
      conn.destroy()
      throw new CancellationError('Request cancelled before connection established')
    }

    cancelFns.push(() => conn.destroy())

    const isHasBodyRequest = !!body && method !== 'GET' && method !== 'HEAD'

    conn.prepare({
      method,
      path,
      headers: {
        Host: host,
        ...headers,
      },
      body: isHasBodyRequest ? body : '',
    })

    if (!targetTime) {
      const req = conn.fire()
      cancelFns.push(() => req.cancel())
      return req
    }

    // 定时发送：等到目标时间再 fire
    return new Promise<HttpResponse>((resolve, reject) => {
      const cancelTimer = doOnTargetTime(() => {
        if (cancelled)
          return
        try {
          const req = conn.fire()
          cancelFns.push(() => req.cancel())
          req.then(resolve, reject)
        }
        catch (err) {
          reject(err)
        }
      }, targetTime)
      cancelFns.push(cancelTimer)
    })
  }) as CancelableRequest

  promise.cancel = () => {
    if (cancelled)
      return
    cancelled = true
    for (const fn of cancelFns) {
      try {
        fn()
      }
      catch (err) {
        console.error('Error during cancellation:', err)
      }
    }
    cancelFns.length = 0
  }

  return promise
}

export default request
