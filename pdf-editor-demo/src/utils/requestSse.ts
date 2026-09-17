import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import { getToken, getOpenID } from '@/utils/webStorage'
import { buildQueryString, safeJsonParse } from '@/utils/tools'
import { useCounterStore } from '@/store/counter'

export type SSECloseReason = 'abort' | 'idle'

export interface SSECloseEvent {
  reason: SSECloseReason
}

/** SSE 请求配置（axios 风格） */
export interface FetchEventOptions {
  /** 基础 URL，拼到 url 前面 */
  baseURL?: string
  /** 路径，如 '/api/sse/event' */
  url: string
  /** HTTP 方法，默认 GET */
  method?: 'GET' | 'POST'
  /** GET 时自动序列化为 query string */
  params?: Record<string, any>
  /** POST 时自动 JSON.stringify 为 body */
  data?: any
  /** 额外请求头（合并到默认 headers，用户值优先） */
  headers?: Record<string, string>
  /** 收到 SSE 消息（已 JSON.parse） */
  onmessage: (data: any) => void
  /** 客户端正常结束回调；主动取消和业务空闲关闭都会触发一次 */
  onclose?: (event: SSECloseEvent) => void
  /** 重连耗尽 / 连接彻底失败回调 */
  onerror?: (err: any) => void
  /** 超时后，支持自定义判断是否需重连 false表示不需要，默认true */
  shouldReconnectOnHeartbeatTimeout?: () => boolean | Promise<boolean>
  /** 无 SSE 事件超时时间，默认 60 秒；这是静默检测，不是客户端主动发送心跳 */
  heartbeatTimeout?: number
}

/** fetchEvent 返回值 */
export interface FetchEventResult {
  /** 取消连接 */
  abort: () => void
}

/** 拼接完整 URL */
const buildUrl = (baseURL: string, url: string, params?: Record<string, any> | null): string => {
  const base = baseURL ? baseURL.replace(/\/+$/, '') : ''
  const path = url.startsWith('/') ? url : `/${url}`
  let fullUrl = `${base}${path}`
  if (params) {
    const qs = buildQueryString(params)
    if (qs) {
      fullUrl += `?${qs}`
    }
  }
  return fullUrl
}

/** 最大重连次数 */
const maxReconnectAttempts = 10
/** 第 1 次异常重连的基础延迟：2 秒 */
const baseReconnectDelay = 2000
/** 第 5～10 次异常重连的基础延迟封顶为 30 秒 */
const maxReconnectDelay = 30000
/** 实际延迟取基础延迟的 80%～100%，避免大量客户端在同一时刻重连 */
const reconnectJitterFloor = 0.8
const defaultHeartbeatTimeout = 60000

/**
 * SSE 连接错误。
 * name 便于日志识别
 * retryable  核心! 用于区分“可以自动恢复”和“重试也无意义”的错误。
 */
class SSEConnectionError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = 'SSEConnectionError'
  }
}

/**
 * 计算第 attempt 次异常后的重连时间。
 * 基础档位为 2s、4s、8s、16s、30s，并加入 80%～100% 随机抖动避免客户端同时重连。
 */
const getRetryDelay = (attempt: number) => {
  const exponentialDelay = Math.min(baseReconnectDelay * Math.pow(2, attempt), maxReconnectDelay)
  const jitterFactor = reconnectJitterFloor + Math.random() * (1 - reconnectJitterFloor)
  return Math.round(exponentialDelay * jitterFactor)
}

/**
 * 判断 HTTP 状态是否值得自动重试
 * - 408：请求超时
 * - 425：请求发送过早，服务端提示稍后重试
 * - 429：服务端限流；等待可能恢复
 * - 500：服务端内部临时异常
 * - 502：网关错误
 * - 503：服务过载、维护或暂时不可用
 * - 504：网关超时
 */
const isRetryableStatus = (status: number) => [408, 425, 429, 500, 502, 503, 504].includes(status)

const validateResponse = (response: Response) => {
  if (!response.ok) {
    throw new SSEConnectionError(
      `SSE connection failed: ${response.status}`,
      isRetryableStatus(response.status)
    )
  }

  const contentType = response.headers.get('content-type')
  if (!contentType?.startsWith(EventStreamContentType)) {
    throw new SSEConnectionError(`Expected content-type error: ${contentType}`, false)
  }
}

/**
 * 建立 SSE 连接
 * - 每次调用创建独立连接，返回 { abort } 供调用方取消
 * - 连续 60s 无事件视为连接静默超时；业务层可决定使用新连接重连或正常关闭
 * - 异常重连基础时间：2s、4s、8s、16s、30s（第 5～10 次均为 30s）
 * - 实际重连时间为基础时间的 80%～100%，从本次失败发生时开始计时
 * - 连续异常最多重连 10 次；收到任意 SSE 事件后，连续失败次数清零
 */
export function fetchEvent(options: FetchEventOptions): FetchEventResult {
  const {
    baseURL = import.meta.env.VITE_API_BASE_URL,
    url,
    method = 'GET',
    params,
    data,
    headers: userHeaders,
    onmessage,
    onclose,
    onerror,
    shouldReconnectOnHeartbeatTimeout,
    heartbeatTimeout = defaultHeartbeatTimeout
  } = options
  const counterStore = useCounterStore()
  // GET 请求
  const query = method === 'GET' ? params : null
  // 构建请求
  const fullUrl = buildUrl(baseURL, url, query)
  const body = method === 'POST' && data !== undefined ? JSON.stringify(data) : undefined

  /** 当前正在使用的 Fetch 连接控制器；每次重连都会替换成新实例，旧实例不能复用。 */
  let activeController: AbortController | null = null
  /** 连接成功后启动；每次收到 SSE 事件都会重新计时。 */
  let heartbeatTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  /** 整个 fetchEvent 客户端是否已经永久停止；停止后任何旧异步回调都不能再重连。 */
  let isStopped = false
  /** 连续异常次数；连接成功但未收到事件时不会提前清零，避免短连接无限首档重试。 */
  let reconnectAttempts = 0

  /** 清除无事件超时计时器。 */
  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      clearTimeout(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const buildHeaders = () => {
    // 每次实际建连都重新读取凭据，避免自动重连继续使用已经刷新的旧 token。
    const token = getToken()
    const openID = getOpenID()
    const defaultHeaders: Record<string, string> = {}
    if (counterStore.isLogin && token) {
      defaultHeaders['Authorization'] = token
    }
    if (!counterStore.isLogin && openID) {
      defaultHeaders['open-id'] = openID
    }
    const headers = {
      ...defaultHeaders,
      ...(userHeaders || {})
    }
    const hasContentType = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type')
    if (body !== undefined && !hasContentType) {
      headers['Content-Type'] = 'application/json'
    }
    return headers
  }

  /** 当前异步回调是否仍属于正在使用的连接，防止旧连接回调干扰新连接。 */
  const isActive = (controller: AbortController) => {
    return !isStopped && activeController === controller
  }

  /** 清理当前连接和心跳计时器。 */
  const dispose = () => {
    clearHeartbeat()
    activeController?.abort()
    activeController = null
  }

  /** 以正常原因永久关闭整个 SSE 客户端。 */
  const close = (reason: SSECloseReason) => {
    if (isStopped) return
    isStopped = true
    dispose()
    onclose?.({ reason })
  }

  /** 重连耗尽或遇到不可重试错误时，永久停止并通知调用方。 */
  const fail = (err: unknown) => {
    if (isStopped) return
    isStopped = true
    dispose()
    onerror?.(err)
  }

  /**
   * 创建一轮新的 fetchEventSource 生命周期。
   * 普通网络异常由依赖库在本轮内部重试；只有心跳超时且仍有业务时，才会再次调用 connect。
   */
  function connect() {
    if (isStopped) return
    clearHeartbeat()

    const controller = new AbortController()
    activeController = controller

    /** 连续指定时间未收到 SSE 事件的处理逻辑 */
    const handleTimeout = async () => {
      if (!isActive(controller)) return

      clearHeartbeat()
      // 当前连接连续超时未收到事件，先停止这个可疑连接；AbortController 不可复用。
      activeController = null
      controller.abort()

      let shouldReconnect = true
      try {
        shouldReconnect = (await shouldReconnectOnHeartbeatTimeout?.()) ?? true
      } catch {
        // 业务状态查询失败时保守重连，避免遗漏仍在进行的任务结果
      }

      if (isStopped || activeController !== null) return
      if (shouldReconnect) {
        connect()
      } else {
        close('idle')
      }
    }

    /** 重启心跳计时器 */
    const resetHeartbeat = () => {
      clearHeartbeat()
      heartbeatTimer = setTimeout(handleTimeout, heartbeatTimeout)
    }

    fetchEventSource(fullUrl, {
      method,
      headers: buildHeaders(),
      body,
      signal: controller.signal,
      // 转换任务在后台仍需要接收完成事件，避免依赖库因 document.hidden 暂停连接。
      openWhenHidden: true,
      onopen: async (response) => {
        // 心跳重建后，旧连接即使晚到达也不能再修改新连接的心跳状态。
        if (!isActive(controller)) return

        validateResponse(response)
        resetHeartbeat()
      },
      onmessage: (event) => {
        // 忽略已经被心跳重建或主动关闭的旧连接消息，防止清除新连接的心跳计时器。
        if (!isActive(controller)) return
        resetHeartbeat()
        // 收到任意 SSE 事件（包括空数据 heartbeat）即可证明连接存活，连续失败次数清零。
        reconnectAttempts = 0
        try {
          onmessage(safeJsonParse(event.data, event.data))
        } catch (err) {
          console.error('onmessage handler failed', err)
        }
      },
      onclose: () => {
        // 服务端意外结束响应流也应进入统一退避重连；业务主动关闭会先 abort 当前连接。
        throw new SSEConnectionError('SSE connection closed unexpectedly')
      },
      onerror: (err) => {
        /**
         * 普通连接异常直接使用依赖库内部重试：返回毫秒数后，库会在该时间后重新 Fetch。
         * 这样复用库已有的重连定时器、取消逻辑。
         * 心跳超时仍由外层处理，因可能先查询业务任务，再决定新建连接还是正常关闭。
         * 抛出错误表示不可重试或次数耗尽，库会停止重试并进入下面的最终 catch。
         */
        if (!isActive(controller)) throw err
        clearHeartbeat()
        const retryable = !(err instanceof SSEConnectionError) || err.retryable
        if (!retryable || reconnectAttempts >= maxReconnectAttempts) throw err

        const delay = getRetryDelay(reconnectAttempts)
        reconnectAttempts += 1
        // 延迟从本次失败发生时开始计算，不包含前一次 Fetch 自身已经消耗的时间。
        return delay
      }
    }).catch((err) => {
      if (!isActive(controller) || controller.signal.aborted) {
        return
      }
      fail(err)
    })
  }

  connect()

  return {
    abort: () => close('abort')
  }
}
