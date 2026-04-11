# 指定时间请求优化

本仓库用于对于指定时间发起网络请求探索的记录。

## 需求

假设现在的需求是，要在某个确定的时间点对一个 API 接口进行请求。

## 优化思路

提前对接口进行 tcp 连接，并且将大部分内容先传输到后端。由于没有将所有的请求内容都传输过去，所以接口会一直保持连接。等时间一到，再将最后一点数据传输过去，触发请求完成条件。

这样可以节省请求 dns 服务器、建立 tcp 连接以及传输请求内容的时间，从而大大减少发起请求 到 服务器响应之间的时间。

## 安装

```bash
npm install @l123wx/specified-time-request
```

## API 文档

### `request(options)`

发送支持精确时间控制的 HTTP/HTTPS 请求。

#### 参数

##### `RequestOptions`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `host` | `string` | ✅ | - | 目标主机名或 IP 地址 |
| `port` | `number` | ✅ | - | 目标端口号（0-65535） |
| `method` | `string` | ❌ | `'GET'` | HTTP 请求方法 |
| `path` | `string` | ❌ | `'/'` | 请求路径 |
| `headers` | `Record<string, string>` | ❌ | `{}` | 自定义请求头 |
| `body` | `string` | ❌ | `''` | 请求体内容 |
| `targetTime` | `Time` | ❌ | - | 精确发送时间 |
| `https` | `boolean` | ❌ | `false` | 是否使用 HTTPS |

##### `Time` 类型

```typescript
type Time = string | number | Date
```

- `string`: ISO 8601 格式，如 `"2024-01-01T12:00:00.000Z"`
- `number`: Unix 时间戳（毫秒），如 `1704096000000`
- `Date`: JavaScript Date 对象

#### 返回值

`CancelableRequest<HttpResponse>` - 带有 `cancel()` 方法的 Promise

##### `HttpResponse`

| 字段 | 类型 | 说明 |
|------|------|------|
| `statusCode` | `number` | HTTP 状态码 |
| `statusText` | `string` | HTTP 状态文本 |
| `headers` | `Record<string, string>` | 响应头（小写键名） |
| `body` | `string` | 响应体内容 |

#### 方法

##### `cancel(reason?: string)`

取消进行中的请求。

**参数：**
- `reason` - 取消原因（可选）

#### 示例

```ts
import request from '@l123wx/specified-time-request'

// 基本请求
const response = await request({
  host: 'example.com',
  port: 80,
  path: '/',
  method: 'GET',
})

// 精确时间请求
const response = await request({
  host: 'localhost',
  port: 80,
  path: '/',
  method: 'GET',
  targetTime: '2025/12/3 15:30:00',
  https: true,
})

// 可取消的请求
const req = request({
  host: 'example.com',
  port: 80,
  targetTime: Date.now() + 5000
})

setTimeout(() => {
  req.cancel('取消原因')
}, 1000)

try {
  await req
}
catch (error) {
  if (error instanceof CancellationError) {
    console.log('请求已取消')
  }
}
```

### `Connection` 类

底层连接控制器，将连接建立、请求准备和触发发送分离，支持更精细的控制场景。

> `request()` 内部就是使用 `Connection` 实现的。

#### 生命周期

```
Connection.connect() → prepare() → fire()
                                 → destroy()
```

#### 静态方法

##### `Connection.connect(host, port, https?)`

建立 TCP/TLS 连接，返回 `Connection` 实例。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `host` | `string` | ✅ | - | 目标主机名 |
| `port` | `number` | ✅ | - | 目标端口号 |
| `https` | `boolean` | ❌ | `false` | 是否使用 HTTPS |

#### 实例方法

##### `prepare(options)`

发送请求头和请求体（不含最后触发数据），使服务器处于等待状态。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `method` | `string` | ❌ | `'GET'` | HTTP 方法 |
| `path` | `string` | ❌ | `'/'` | 请求路径 |
| `headers` | `Record<string, string>` | ❌ | `{}` | 请求头 |
| `body` | `string` | ❌ | `''` | 请求体 |

##### `fire()`

发送触发数据完成请求，设置响应解析器，返回响应。

返回 `CancelableRequest<HttpResponse>`。

##### `destroy()`

主动销毁连接。

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `isAlive` | `boolean` | 连接是否存活 |
| `createdAt` | `number` | 连接建立时间戳（毫秒） |
| `preparedAt` | `number \| null` | `prepare()` 调用时间戳（毫秒），未调用时为 `null` |

#### 示例

```ts
import { Connection } from '@l123wx/specified-time-request'

// 基本请求
const conn = await Connection.connect('example.com', 443, true)
conn.prepare({
  method: 'POST',
  path: '/api/checkout',
  headers: {
    'Host': 'example.com',
    'Content-Type': 'application/json',
    'Authorization': 'Bearer token',
  },
  body: JSON.stringify({ item: 'test' }),
})
const response = await conn.fire()

// 预连接池：提前建连，失败时快速重试
const pool = await Promise.all([
  Connection.connect('example.com', 443, true),
  Connection.connect('example.com', 443, true),
  Connection.connect('example.com', 443, true),
])

for (const conn of pool) {
  conn.prepare({ /* ... */ })
}

// 尝试第一个连接
try {
  const res = await pool[0].fire()
}
catch {
  // 失败立即用第二个连接重试
  const res = await pool[1].fire()
}
```

### `testTimeout(conn)`

等待服务器断开连接，返回连接保持时间。用于测试特定接口的空闲连接超时时间。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `conn` | `Connection` | ✅ | 已建立（并可选调用过 `prepare()`）的连接 |

返回 `Promise<TimeoutResult>`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `connectedMs` | `number` | 从连接建立到关闭的总时间 |
| `preparedMs` | `number \| undefined` | 从 `prepare()` 到关闭的时间（调用 `prepare()` 后才有值） |

### `testConnectionTimeout(options)`

便捷函数：测试指定接口的服务器空闲连接超时时间。内部使用 `Connection` 实现，参数与 `request()` 相同（忽略 `targetTime`）。

#### 示例

```ts
import { testConnectionTimeout } from '@l123wx/specified-time-request'

const result = await testConnectionTimeout({
  host: 'api.example.com',
  port: 443,
  https: true,
  method: 'POST',
  path: '/api/checkout',
  body: JSON.stringify({ item: 'test' }),
  headers: { Authorization: 'Bearer token' },
})

console.log(`连接保持 ${result.connectedMs}ms`)
console.log(`请求等待 ${result.preparedMs}ms`)
// 根据结果决定提前多久建连，确保不超过 preparedMs
```

### `testMinDataRate(options, maxWaitMs?, precisionMs?, rateOptions?)`

测试服务器对请求体数据速率的最小要求。使用二分查找找出 `prepare()` 到 `fire()` 之间最大可等待时长。

某些服务器（如 ASP.NET Core/Kestrel）有 `MinRequestBodyDataRate` 限制，如果请求体数据传输太慢会拒绝请求。此函数通过检查响应状态码判断请求是否成功。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `options` | `RequestOptions` | ✅ | - | 请求配置（**必须有 body**） |
| `maxWaitMs` | `number` | ❌ | `5000` | 最大测试等待时间（毫秒） |
| `precisionMs` | `number` | ❌ | `50` | 测试精度（毫秒） |
| `rateOptions` | `MinDataRateOptions` | ❌ | `{}` | 额外的测试选项 |

##### `MinDataRateOptions`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `successStatusCodes` | `number[]` | ❌ | `[]` | 认为成功的状态码列表，空数组时默认 2xx |
| `testTimeoutMs` | `number` | ❌ | `5000` | 单次测试的响应超时时间（毫秒） |

返回 `Promise<MinDataRateResult>`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `maxWaitMs` | `number` | 最大可等待时长（毫秒），超过此值服务器会拒绝请求 |
| `precisionMs` | `number` | 使用的测试精度 |
| `iterations` | `number` | 测试次数 |
| `statusCode` | `number` | 最后一次成功测试时的响应状态码 |

#### 示例

```ts
import { testMinDataRate } from '@l123wx/specified-time-request'

const result = await testMinDataRate({
  host: 'api.example.com',
  port: 443,
  https: true,
  method: 'POST',
  path: '/api/checkout',
  body: JSON.stringify({ item: 'test' }),
  headers: { Authorization: 'Bearer token' },
})

console.log(`最大可等待 ${result.maxWaitMs}ms，超过会超时`)
console.log(`测试精度: ±${result.precisionMs}ms，测试 ${result.iterations} 次`)
console.log(`最后成功响应状态码: ${result.statusCode}`)
```

### `doOnTargetTime(callback, targetTime)`

在精确的目标时间执行回调。使用 `setTimeout` 提前唤醒 + 忙等待实现毫秒级精度。

| 参数 | 类型 | 说明 |
|------|------|------|
| `callback` | `() => any` | 目标时间到达时执行的回调 |
| `targetTime` | `Time` | 目标执行时间 |

返回取消函数 `() => void`，调用后回调不再执行。

### 导出类型

```typescript
import type {
  CancellationError,
  Connection,
  ConnectOptions,
  MinDataRateOptions,
  MinDataRateResult,
  RequestInit,
  RequestOptions,
  TimeoutResult,
} from '@l123wx/specified-time-request'
```

### 时间精度

- **理论精度**：±1ms
- **实测精度**：±10ms
- **最佳适用**：延迟 ≥ 100ms
