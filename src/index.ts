import request from './request'

export default request

export { Connection } from './connection'
export type { ConnectOptions, RequestInit, TimeoutResult } from './connection'
export { CancellationError } from './connection'
export type { RequestOptions, Time } from './request'
export { doOnTargetTime } from './request'

// 测试工具函数
export { testConnectionTimeout, testMinDataRate, testTimeout } from './tool'
export type { MinDataRateOptions, MinDataRateResult } from './tool'
