/**
 * 记录当前打开了哪些抽屉（Sheet）。
 *
 * 返回键的处理（ExitGuard）需要知道「有没有抽屉开着」：有就先关抽屉，
 * 而不是弹退出确认。以前是靠 `document.querySelector('.sheet-backdrop')`
 * 反查 DOM，样式类一改就静默失效，这里改成显式登记。
 */

let nextId = 1
const open = new Map<number, () => void>()

/** 登记一个打开的抽屉，返回注销函数（组件卸载 / 关闭时调用）。 */
export function registerSheet(close: () => void): () => void {
  const id = nextId++
  open.set(id, close)
  return () => {
    open.delete(id)
  }
}

export function hasOpenSheet(): boolean {
  return open.size > 0
}

/** 关掉最后打开的那个抽屉；没有打开的返回 false。 */
export function closeTopSheet(): boolean {
  let lastId = 0
  for (const id of open.keys()) lastId = id
  const close = open.get(lastId)
  if (!close) return false
  close()
  return true
}
