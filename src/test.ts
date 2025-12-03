import request, { doOnTargetTime } from './request'

// 使用示例
async function main(): Promise<void> {
  const targetTime = '2025/12/3 18:02:50'

  request({
    host: 'localhost',
    port: 80,
    path: '/',
    method: 'GET',
    targetTime,
    https: true,
  }).then(console.warn)

  doOnTargetTime(async () => {
    console.warn('Fetch start:', new Date().toISOString())
    const repo = await fetch('http://localhost', {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    })
    const res = await repo.text()
    console.warn(res)
    console.warn('Fetch end:', new Date().toISOString())
  }, targetTime)
}

main()
