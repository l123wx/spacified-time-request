# HTTP请求结束判定方式详解

本文档详细说明HTTP GET和POST请求结束的判定方式，以及各个HTTP版本的差异。基于实际项目中的HTTP服务器实现经验总结。

## 📋 关键总结

| 判定方式 | 触发条件 | TCP连接状态 |
|---------|---------|------------|
| Content-Length | 收到指定字节数后 | 通常保持打开（keep-alive） |
| chunked编码 | 收到 `0\r\n\r\n` | 通常保持打开 |
| 连接关闭 | 收到TCP EOF信号 | 连接关闭 |
| 空行（无请求体） | 收到 `\r\n\r\n` | 通常保持打开 |

## 📚 请求类型总结

| 请求类型 | 判断传输结束的主要方式 | 关键点 |
|---------|---------------------|--------|
| GET请求 | 接收到的数据中包含 `\r\n\r\n` | 无请求体，空行即结束 |
| 带体的POST请求 | 1. Content-Length 头指定的字节数<br>2. Transfer-Encoding: chunked 模式下的结束块 `0\r\n\r\n`<br>3. 连接关闭（不推荐） | 需先读完请求头，再按规则读请求体 |

总的来说，GET请求的结束判断是所有HTTP请求中最简单的一种。如果你是在编写底层服务器，核心就是解析那个空行；如果你使用的是 Express、Koa 等Web框架，它们已经完美地处理了所有这些底层细节，你可以直接编写路由处理函数而无需关心接收过程。

## 🔍 详细说明

### 1. GET请求结束判定

GET请求是最简单的HTTP请求类型，因为它没有请求体。结束判定非常简单：

```http
GET /api/users HTTP/1.1
Host: example.com
User-Agent: curl/7.68.0
Accept: application/json
\r\n\r\n  ← 这里就是请求结束的位置
```

**判定逻辑：**
1. 读取请求行（第一行）
2. 读取请求头（直到遇到空行 `\r\n\r\n`）
3. 请求结束，可以开始处理

### 2. POST请求结束判定

POST请求有请求体，结束判定更复杂，有三种主要方式：

#### 方式一：Content-Length（最常用）

```http
POST /api/users HTTP/1.1
Host: example.com
Content-Type: application/json
Content-Length: 27
\r\n\r\n
{"name": "John", "age": 30}  ← 读取27个字节后结束
```

**判定逻辑：**
1. 读取请求头
2. 检查 `Content-Length` 头部
3. 读取指定字节数的请求体
4. 请求结束

#### 方式二：Transfer-Encoding: chunked（流式传输）

```http
POST /api/users HTTP/1.1
Host: example.com
Content-Type: application/json
Transfer-Encoding: chunked
\r\n\r\n
1A  ← 十六进制表示块大小（26字节）
{"name": "John", "age": 30}
0   ← 结束块
\r\n\r\n  ← 请求结束
```

**判定逻辑：**
1. 读取请求头
2. 检查 `Transfer-Encoding: chunked`
3. 循环读取块：
   - 读取块大小（十六进制）
   - 读取指定大小的数据
   - 读取 `\r\n`
4. 当块大小为 `0` 时，请求结束

#### 方式三：连接关闭（不推荐）

```http
POST /api/users HTTP/1.1
Host: example.com
Content-Type: application/json
Connection: close
\r\n\r\n
{"name": "John", "age": 30}EOF  ← TCP连接关闭表示结束
```

**判定逻辑：**
1. 读取请求头
2. 检查 `Connection: close`
3. 持续读取直到TCP连接关闭
4. 请求结束

## 🌐 HTTP版本差异

### HTTP/0.9（1991年）
- 只有GET方法
- 无请求头
- 响应只有正文，无状态码
- 请求结束：TCP连接关闭

### HTTP/1.0（1996年）
- 引入POST、HEAD方法
- 引入请求头、响应头
- 引入状态码
- **默认行为**：每个请求后关闭TCP连接
- 请求结束判定：
  - GET：`\r\n\r\n`
  - POST：`Content-Length` 或连接关闭

### HTTP/1.1（1997年，当前主流）
- 引入持久连接（keep-alive）**默认开启**
- 引入chunked传输编码
- 引入Host头部（支持虚拟主机）
- **关键改进**：一个TCP连接可发送多个请求
- 请求结束判定：
  - GET：`\r\n\r\n`
  - POST：`Content-Length`、`Transfer-Encoding: chunked` 或连接关闭

### HTTP/2（2015年）
- 二进制协议（非文本）
- 多路复用（多个请求/响应并行）
- 头部压缩（HPACK - HTTP/2的头部压缩算法）
- 服务器推送
- **请求结束**：流（stream）结束帧
- 不再需要chunked编码（流式传输原生支持）

### HTTP/3（2022年）
- 基于QUIC（Quick UDP Internet Connections - 基于UDP的传输协议）
- 0-RTT连接建立
- 改进的多路复用
- 更好的丢包处理
- **请求结束**：流结束信号

## 🛠️ 实际应用示例

### 示例1：简单GET服务器（Node.js原生）

```javascript
import { createServer } from 'node:http'

const server = createServer((req, res) => {
  // 对于GET请求，req.on('data')不会触发
  // 因为GET没有请求体

  req.on('end', () => {
    // 请求头已完全接收
    console.warn(`GET请求到: ${req.url}`)
    res.end('OK')
  })
})
```

### 示例2：处理POST请求（Content-Length）

```javascript
import { createServer } from 'node:http'

const server = createServer((req, res) => {
  if (req.method === 'POST') {
    let body = ''
    let receivedBytes = 0
    const contentLength = Number.parseInt(req.headers['content-length'], 10)

    req.on('data', (chunk) => {
      body += chunk
      receivedBytes += chunk.length

      // 检查是否接收完成
      if (receivedBytes >= contentLength) {
        // 请求体接收完成
        console.warn('POST数据:', body)
        res.end('Received')
      }
    })
  }
})
```

### 示例3：处理chunked编码

```javascript
import { createServer } from 'node:http'

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.headers['transfer-encoding'] === 'chunked') {
    let body = ''

    // Node.js会自动处理chunked解码
    req.on('data', (chunk) => {
      body += chunk
    })

    req.on('end', () => {
      // 所有chunk已接收并解码
      console.warn('Chunked数据:', body)
      res.end('Received')
    })
  }
})
```

## 🎯 结论

HTTP请求结束的判定不是靠TCP连接断开，而是通过协议规则：

1. **大多数情况**：通过 `Content-Length` 或 `Transfer-Encoding: chunked` 的结束标记
2. **请求结束 ≠ TCP连接结束**：HTTP/1.1默认保持连接
3. **后端逻辑开始时机**：
   - 对于有明确长度的请求：收到完整字节数后
   - 对于chunked请求：收到 `0\r\n\r\n` 后
   - 对于无请求体的请求：收到空行后

这就是为什么你可以在一个TCP连接上发送多个HTTP请求（HTTP流水线），服务器能明确知道每个请求的边界。

## 📖 参考资料

1. [RFC 2616 - HTTP/1.1](https://tools.ietf.org/html/rfc2616)
2. [RFC 7540 - HTTP/2](https://tools.ietf.org/html/rfc7540)
3. [RFC 9114 - HTTP/3](https://tools.ietf.org/html/rfc9114)
4. [MDN Web Docs - HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP)

---

*本文档基于实际项目中的HTTP服务器实现经验总结，适用于理解底层HTTP协议工作原理。*

---
