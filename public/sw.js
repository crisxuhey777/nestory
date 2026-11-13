/* Nestory 的 Service Worker。
 *
 * 只做两件事：让「添加到主屏幕」成立、承接系统通知的点击。
 * 故意不缓存页面和接口：样式和脚本都带 hash，缓存反而容易让家人看到旧版本。
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// 需要存在 fetch 处理器，Chrome 才认为这是一个可安装的 PWA；这里直接放行。
self.addEventListener('fetch', () => {})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL('/#/reminders', self.location.origin)
  const data = event.notification.data || {}
  if (typeof data.url === 'string' && data.url.startsWith('/')) {
    target.href = new URL(data.url, self.location.origin).href
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target.href)
          return
        }
      }
      await self.clients.openWindow(target.href)
    })(),
  )
})
