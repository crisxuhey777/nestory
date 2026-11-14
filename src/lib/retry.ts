/** 保存失败后的重试节奏：先 5s、再 15s，之后一直每分钟一次，直到成功。 */
const RETRY_DELAYS = [5_000, 15_000, 60_000]

/** 第 n 次重试（从 0 开始）应等待的毫秒数；超出表长后固定用最后一档。 */
export function retryDelay(attempt: number): number {
  const index = Math.min(Math.max(Math.trunc(attempt) || 0, 0), RETRY_DELAYS.length - 1)
  return RETRY_DELAYS[index]
}

/** 重试间隔表（只读，供测试断言） */
export function retrySchedule(): readonly number[] {
  return RETRY_DELAYS
}
