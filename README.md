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

### 导出类型

```typescript
import type { CancellationError, RequestOptions } from '@l123wx/specified-time-request'
```

### 时间精度

- **理论精度**：±1ms
- **实测精度**：±10ms
- **最佳适用**：延迟 ≥ 100ms
