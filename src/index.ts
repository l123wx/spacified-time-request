import request, { doOnTargetTime } from './request'

// 使用示例
async function main(): Promise<void> {
  const targetTime = '2025/12/3 17:03:40'

  request({
    host: 'localhost',
    port: 80,
    method: 'GET',
    targetTime,
  })

  doOnTargetTime(() => {
    console.warn('Fetch start:', new Date().toISOString())
    fetch('http://localhost/', {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    })
    console.warn('Fetch end:', new Date().toISOString())
  }, targetTime)
}

main()
