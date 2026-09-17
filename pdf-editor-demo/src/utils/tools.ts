/**
 * 浏览器空闲时执行回调。不支持 requestIdleCallback 时降级为 setTimeout（宏任务）。
 * 不用 Promise（微任务会阻塞渲染）。
 * @param callback 空闲时执行的回调
 * @param timeout 最长等待时间（ms），超时后强制执行
 * @returns 任务 ID，可用于 cancelIdleTask 取消
 */
export function scheduleIdleTask(callback: () => void, timeout = 2000) {
  if (typeof window !== 'undefined' && window.requestIdleCallback) {
    return window.requestIdleCallback(callback, { timeout })
  }
  // 降级：宏任务（setTimeout），在渲染间隙执行，不阻塞 UI
  return window.setTimeout(callback, 1)
}

/** 取消已调度的空闲任务 */
export function cancelIdleTask(id: number) {
  if (typeof window !== 'undefined' && window.cancelIdleCallback) {
    window.cancelIdleCallback(id)
  } else {
    clearTimeout(id)
  }
}

/** 将对象转为 query string 格式 */
export const buildQueryString = (params: Record<string, any>): string => {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '')
  return entries.length ? new URLSearchParams(entries).toString() : ''
}

/**
 * OffscreenCanvas 可用性探测（主线程侧）。
 * OffscreenCanvas 离屏渲染不绑定 DOM，convertToBlob() 比 HTMLCanvasElement.toBlob() 更快。
 */
export const isOffscreenCanvasAvailable = typeof OffscreenCanvas !== 'undefined'

export {}
