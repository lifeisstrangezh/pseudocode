import { h } from 'vue'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { MessageOptions } from 'element-plus'
import { clone } from 'lodash'
import { useCounterStore } from '@/store/counter'
export * from './webStorage'
import Close from '@/assets/svg/common/messClose.svg'
import Error from '@/assets/svg/common/messError.svg'
import Success from '@/assets/svg/common/messSuccess.svg'
import Primary from '@/assets/svg/common/primary.svg'

/**
 * 数据处理工具
 */

// 安全 JSON 解析（带类型转换）
export function safeJsonParse<T>(str: string, defaultValue: T): T {
  try {
    return JSON.parse(str) ?? defaultValue
  } catch {
    return defaultValue
  }
}

// 浅拷贝（基础版，注意不能处理复杂对象）
export function shallowClone<T>(obj: T): T {
  return clone ? clone(obj) : JSON.parse(JSON.stringify(obj))
}

export function deepClone<T>(target: T): T {
  // 处理循环引用
  const weakMap = new WeakMap()

  function clone<U>(data: U): U {
    // 处理null或undefined
    if (data === null || data === undefined) {
      return data
    }

    // 处理日期对象
    if (data instanceof Date) {
      return new Date(data.getTime()) as any
    }

    // 处理正则表达式
    if (data instanceof RegExp) {
      return new RegExp(data) as any
    }

    // 处理基本类型
    if (typeof data !== 'object') {
      return data
    }

    // 检查循环引用
    if (weakMap.has(data as object)) {
      return weakMap.get(data as object)
    }

    // 处理数组
    if (Array.isArray(data)) {
      const arr: any[] = []
      weakMap.set(data, arr)
      arr.push(...data.map((item) => clone(item)))
      return arr as any
    }

    // 处理普通对象
    const obj = Object.create(Object.getPrototypeOf(data))
    weakMap.set(data as object, obj)

    for (const key of Reflect.ownKeys(data as object)) {
      obj[key] = clone((data as any)[key])
    }

    return obj
  }

  return clone(target)
}

// 日期格式化 (YYYY-MM-DD HH:mm:ss)
export function formatDate(date: Date | number | string, format = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = new Date(date)
  const pad = (n: number) => String(n).padStart(2, '0')

  return format
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()))
}

// 数字千分位格式化 (1,234.56)
export function formatNumber(num: number | string, decimals = 2): string {
  const n = parseFloat(String(num))
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

// 获取文件类型
export function getFileType(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex !== -1 && lastDotIndex < fileName.length - 1) {
    return fileName.substring(lastDotIndex + 1).toLowerCase()
  }
  return ''
}

/**
 * 状态管理工具
 */

// 重置 Pinia Store 状态
export function resetStoreState(store: Global.AnyObject): void {
  const initialState = store.$state ? deepClone(store.$state()) : {}
  store.$reset = () => store.$patch(deepClone(initialState))
}

// 获取当前存储的 state (debug 用)
export function getStoreState(store: Global.AnyObject): Global.AnyObject {
  return store.$state ? deepClone(store.$state) : {}
}

/**
 * 表单验证工具
 */

// 邮箱验证邮箱合规判断
export function validateEmail(rule: any, value: string, callback: (error?: string) => void): void {
  if (!value) {
    return callback('Please input your email')
  }

  if (value.length > 320) {
    return callback('Email cannot exceed 320 characters')
  }

  const [localPart, domainPart] = value.split('@')

  if (!localPart || !domainPart) {
    return callback('Email must contain @ and have text before and after it')
  }

  if (localPart.length > 64 || domainPart.length > 253) {
    return callback('Local part max 64 characters, domain max 253 characters')
  }

  const localPartRegex = /^[a-zA-Z0-9._-]+$/
  const domainPartRegex = /^[a-zA-Z0-9.]+$/

  if (!localPartRegex.test(localPart)) {
    return callback('Local part can only contain letters, numbers, ., -, _')
  }

  if (!domainPartRegex.test(domainPart)) {
    return callback('Domain part can only contain letters, numbers, .')
  }

  if (value.includes('..')) {
    return callback('Email cannot contain consecutive dots')
  }

  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return callback('Local part cannot start or end with .')
  }

  if (domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return callback('Domain part cannot start or end with .')
  }

  if (!domainPart.includes('.')) {
    return callback('Domain must contain at least one .')
  }

  callback() // 校验通过
}

// 手机号验证 (中国)
export function validateMobileCN(mobile: string): boolean {
  return /^1[3-9]\d{9}$/.test(mobile)
}

// 密码强度验证（至少包含数字和字母，8-20位）
export function validatePassword(password: string): boolean {
  return /^(?=.*\d)(?=.*[a-zA-Z]).{8,20}$/.test(password)
}

/**
 * 防抖/节流
 */

/**
 * 防抖函数
 * @param fn 需要防抖的函数
 * @param delay 防抖延迟时间（毫秒）
 * @param immediate 是否立即执行（首次调用立刻执行）
 * @returns 包装后的防抖函数（可中途取消）
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay = 300,
  immediate = false
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let isInvoked = false

  return function (this: any, ...args: Parameters<T>) {
    if (timer !== null) clearTimeout(timer)

    // 立即执行逻辑
    if (immediate && !isInvoked) {
      fn.apply(this, args)
      isInvoked = true
    }

    timer = setTimeout(() => {
      if (!immediate) {
        fn.apply(this, args)
      }
      timer = null
      isInvoked = false
    }, delay)
  }
}

// 节流函数（立即执行版本）
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit = 300,
  immediate = true
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout>

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now()
    if (immediate && now - lastCall >= limit) {
      lastCall = now
      fn.apply(this, args)
    } else {
      clearTimeout(timer)
      timer = setTimeout(
        () => {
          lastCall = Date.now()
          fn.apply(this, args)
        },
        limit - (now - lastCall)
      )
    }
  }
}

// 滚动到页面顶部（平滑滚动）
export function scrollToTop(behavior: ScrollBehavior = 'smooth'): void {
  window.scrollTo({ top: 0, behavior })
}

/**
 * 对象操作工具
 */

// 深度合并对象
export function deepMerge<T extends Global.AnyObject>(target: T, source: Global.AnyObject): T {
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && !Array.isArray(source[key])) {
      Object.assign(source[key], deepMerge(target[key] || {}, source[key]))
    }
  }
  return Object.assign(target, source)
}

// 获取对象深层属性值
export function getNestedValue(obj: Global.AnyObject, path: string, defaultValue?: any) {
  return path
    .split('.')
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : defaultValue), obj)
}

/**
 * 其他实用工具
 */

// 加载状态封装（组合式函数）
export function useLoading() {
  const loading = ref(false)
  const withLoading = async <T>(fn: () => Promise<T>): Promise<T> => {
    loading.value = true
    try {
      return await fn()
    } finally {
      loading.value = false
    }
  }
  return { loading, withLoading }
}

// 金额单位转换（分到元）
export function fenToYuan(fen: number, decimals = 2): number {
  return Number((fen / 100).toFixed(decimals))
}

// 生成随机HEX颜色
export function randomHexColor(): string {
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
}

// 动态加载资源（CSS/JS）
export function loadResource(url: string, type: 'script' | 'style'): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(type === 'script' ? 'script' : 'link')
    element.onload = () => resolve()
    element.onerror = reject

    if (type === 'script') {
      ;(element as HTMLScriptElement).src = url
    } else {
      ;(element as HTMLLinkElement).href = url
      ;(element as HTMLLinkElement).rel = 'stylesheet'
    }

    document.head.appendChild(element)
  })
}

/**
 * 高级类型工具函数
 */

// 安全类型转换（带类型守卫）
export function safeCast<T>(value: unknown, defaultValue: T): T {
  return typeof value === typeof defaultValue ? (value as T) : defaultValue
}

// 过滤无效值（空值过滤）
export function filterEmptyValues<T extends Global.AnyObject>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== null && v !== undefined && v !== '')
  ) as Partial<T>
}

/**
 * 路由工具
 */

// 安全导航（处理可能的异常）
export async function safeNavigate(
  router: import('vue-router').Router,
  location: import('vue-router').RouteLocationRaw
) {
  try {
    await router.push(location)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('路由跳转失败:', error)
    }
  }
}

/**
 * 剪贴板工具
 */

// 复制到剪贴板（现代API）
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    const result = document.execCommand('copy')
    document.body.removeChild(textarea)
    return result
  }
}

/**
 * 其他实用工具
 */

// 生成唯一ID（简易版）
export function generateId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 18)}`
}

// 模拟延时（异步等待）
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 去除对象中的 undefined 值
export function removeUndefined<T extends Global.AnyObject>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined)) as T
}

// 获取对象数组中指定属性的项
export function pluck<T extends Global.AnyObject, K extends keyof T>(arr: T[], key: K): T[K][] {
  return arr.map((item) => item[key])
}

// 获取对象数组中与某个对象的指定属性相同的项
export function pluckTarget<
  T extends Global.AnyObject,
  K extends keyof T & keyof U,
  U extends Global.AnyObject
>(obj: T, key: K, arr: U[]): U[] {
  return arr.filter((item) => item[key] === (obj[key] as unknown as U[K]))
}

// 封装公共message组件
type MessageType = 'success' | 'warning' | 'info' | 'error' | 'primary'
const baseOffset = 28
export function postMessage(
  type: MessageType,
  message: string,
  showClose: boolean = false,
  duration: number = 3000
) {
  const iconMap = {
    success: Success,
    error: Error,
    warning: '',
    info: '',
    primary: Primary
  }

  // 创建一个 ref 来存储当前 message 实例
  let messageInstance: any = null

  const closeBtn = showClose
    ? h('img', {
        src: Close,
        width: 20,
        height: 20,
        style: 'cursor: pointer; margin-left: 20px;',
        onClick: () => {
          if (messageInstance) {
            // 先关闭当前消息
            messageInstance.close()
          }
        }
      })
    : null

  const options: MessageOptions = {
    type: type === 'primary' ? 'info' : type,
    message: h('div', { style: 'display: flex;', class: 'message-content' }, [
      // 左侧图标容器
      h('div', { style: 'margin-right: 8px; margin-top: 3px;', class: 'message-content-icon' }, [
        h('img', { src: iconMap[type], width: 16, height: 16 })
      ]),
      // 中间文本容器
      h(
        'div',
        {
          style: 'flex: 1; max-width: 456px; word-wrap: break-word;',
          class: 'message-content-text'
        },
        message
      ),
      // 右侧关闭按钮容器
      h('div', { style: 'display: flex; align-items: center;', class: 'message-content-close' }, [
        closeBtn
      ])
    ]),
    duration: duration === 0 ? 0 : duration,
    offset: baseOffset,
    showClose: false,
    customClass: 'custom-message',
    icon: ''
  }
  messageInstance = ElMessage(options)
}

export function removeArrItemByKey<T extends Global.AnyObject>(
  arr: T[],
  key: keyof T,
  value: T[keyof T]
) {
  for (let index = arr.length - 1; index >= 0; index--) {
    const item = arr[index]
    if (item[key] === value) {
      arr.splice(index, 1)
    }
  }
}

/**
 * 通用驼峰转短横线格式（同时兼容 camelCase 和 PascalCase）
 * @param str 输入字符串，例如：helloWorld / HelloWorld
 * @returns 转换后的短横线格式，例如：hello-world
 */
export function camelToKebab(str: string): string {
  if (!str) return ''

  return (
    str
      // 核心逻辑：在大写字母前插入短横线（兼容小驼峰和大驼峰）
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2') // 处理小驼峰（如：helloWorld → hello-World）
      .replace(/([A-Z])/g, '-$1') // 处理大驼峰（如：HelloWorld → -Hello-World）
      .toLowerCase() // 统一转为小写
      .replace(/^-+/, '') // 清除开头的多余短横线
      .replace(/-+/g, '-')
  ) // 合并连续短横线
}

/**
 * 通用短横线转小驼峰格式
 * @param str 输入字符串
 * @returns 转换后的小驼峰格式
 */
export function kebabToCamel(str: string): string {
  if (!str) return ''
  return str
    .split('_')
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('')
}

// 获取8位随机openID
export function generateOpenID() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let uuid = ''
  for (let i = 0; i < 8; i++) {
    uuid += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return uuid
}

export function generateUID(): number {
  // 生成一个基于时间戳和随机数的唯一数字ID
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 10000) // 4位随机数
  return parseInt(`${timestamp}${random}`)
}

export function generateUUID(): string {
  // 生成符合RFC4122版本4标准的UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// 获取浏览器当前时区
export function getBrowserTimeZone() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return timeZone
}

// 获取当前系统及浏览器名称
export const getSystemAndBrowser = () => {
  const ua = navigator.userAgent.toLowerCase()
  let platform = 'Unknown'
  if (ua.indexOf('win') !== -1) {
    platform = 'Windows'
  } else if (ua.indexOf('mac') !== -1) {
    platform = 'MacOS'
  } else if (ua.indexOf('x11') !== -1 || ua.indexOf('linux') !== -1) {
    platform = 'Linux'
  } else if (/android/.test(ua)) {
    platform = 'Android'
  } else if (/iphone|ipad|ipod/.test(ua)) {
    platform = 'IOS'
  }
  return `${platform}`
}

// 获取浏览器名称及其版本号
export const getBrowserNameVersion = () => {
  const ua = navigator.userAgent.toLowerCase()
  let match
  if ((match = ua.match(/rv:([\d.]+)\) like gecko/))) {
    return `IE_${match[1]}`
  } else if ((match = ua.match(/msie ([\d.]+)/))) {
    return `IE_${match[1]}`
  } else if ((match = ua.match(/edg\/([\d.]+)/))) {
    // 更新的正则表达式
    return `Edge_${match[1]}`
  } else if ((match = ua.match(/firefox\/([\d.]+)/))) {
    return `Firefox_${match[1]}`
  } else if ((match = ua.match(/opr\/([\d.]+)/)) || (match = ua.match(/opera\/([\d.]+)/))) {
    return `Opera_${match[1]}`
  } else if ((match = ua.match(/chrome\/([\d.]+)/))) {
    return `Chrome_${match[1]}`
  } else if ((match = ua.match(/version\/([\d.]+).*safari/))) {
    return `Safari_${match[1]}`
  } else {
    return 'Unknown'
  }
}

// 通用下载
export const generalDownload = async (url: string | string[], filename: string | string[]) => {
  // 处理单个文件下载
  if (typeof url === 'string' && typeof filename === 'string') {
    await downloadSingle(url, filename)
    return
  }
  // 处理多个文件下载
  if (Array.isArray(url) && Array.isArray(filename) && url.length === filename.length) {
    for (let i = 0; i < url.length; i++) {
      await downloadSingle(url[i], filename[i])
    }
    return
  }
  console.error('url和filename参数类型不匹配')
}

// 单个文件下载的具体实现
function downloadSingle(url: string, filename: string): Promise<void> {
  return new Promise((resolve) => {
    const store = useCounterStore()
    store.isHandleDowload = true

    // 创建隐藏的 iframe，iframe有独立的浏览上下文，不会打断主页面的其他请求
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)

    // 控制当前 Promise 放行的时间 (代表下一个任务什么时候可以开始)
    setTimeout(() => {
      store.isHandleDowload = false
      resolve()
    }, 500)

    setTimeout(
      () => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      },
      1 * 60 * 1000
    ) // 1 分 后再清理 DOM
  })
}

// loading 图标
export const getLoadingIcon = () => {
  return `<svg width="83" height="83" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#paint0_angular_18466_16115_clip_path)" data-figma-skip-parse="true"><g transform="matrix(-0.00214912 0.0144298 0.0144298 0.00214912 14.0013 14.4987)"><foreignObject x="-1113.24" y="-1113.24" width="2226.48" height="2226.48"><div xmlns="http://www.w3.org/1999/xhtml" style="background:conic-gradient(from 90deg,rgba(3, 98, 250, 0.9708) 0deg,rgba(3, 98, 250, 1) 0.769514deg,rgba(3, 98, 250, 1) 185.682deg,rgba(3, 98, 250, 0.28) 281.472deg,rgba(3, 98, 250, 0) 334.398deg,rgba(3, 98, 250, 0.9708) 360deg);height:100%;width:100%;opacity:1"></div></foreignObject></g></g><path d="M14.0013 27.4779C13.2764 27.4779 12.6888 26.8902 12.6888 26.1654C12.6888 25.4405 13.2764 24.8529 14.0013 24.8529V27.4779ZM7.15284 22.2647C7.6963 22.7443 7.74802 23.5738 7.26834 24.1172C6.78867 24.6607 5.95925 24.7124 5.41579 24.2327L7.15284 22.2647ZM14.0013 26.1654V24.8529C19.7197 24.8529 24.3555 20.2171 24.3555 14.4987H25.668H26.9805C26.9805 21.6669 21.1695 27.4779 14.0013 27.4779V26.1654ZM25.668 14.4987H24.3555C24.3555 8.78025 19.7197 4.14453 14.0013 4.14453V2.83203V1.51953C21.1695 1.51953 26.9805 7.3305 26.9805 14.4987H25.668ZM14.0013 2.83203V4.14453C8.28285 4.14453 3.64713 8.78025 3.64713 14.4987H2.33463H1.02213C1.02213 7.3305 6.83311 1.51953 14.0013 1.51953V2.83203ZM2.33463 14.4987H3.64713C3.64713 17.591 5.00108 20.3655 7.15284 22.2647L6.28431 23.2487L5.41579 24.2327C2.72342 21.8564 1.02213 18.3754 1.02213 14.4987H2.33463Z" data-figma-gradient-fill="{&#34;type&#34;:&#34;GRADIENT_ANGULAR&#34;,&#34;stops&#34;:[{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:1.0},&#34;position&#34;:0.0021375378128141165},{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:1.0},&#34;position&#34;:0.51578325033187866},{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:0.28000000119209290},&#34;position&#34;:0.78186541795730591},{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:0.0},&#34;position&#34;:0.92888349294662476}],&#34;stopsVar&#34;:[{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:1.0},&#34;position&#34;:0.0021375378128141165},{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:1.0},&#34;position&#34;:0.51578325033187866},{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:0.28000000119209290},&#34;position&#34;:0.78186541795730591},{&#34;color&#34;:{&#34;r&#34;:0.011764706112444401,&#34;g&#34;:0.38431373238563538,&#34;b&#34;:0.98039215803146362,&#34;a&#34;:0.0},&#34;position&#34;:0.92888349294662476}],&#34;transform&#34;:{&#34;m00&#34;:-4.2982468605041504,&#34;m01&#34;:28.859659194946289,&#34;m02&#34;:1.7205954790115356,&#34;m10&#34;:28.859655380249023,&#34;m11&#34;:4.2982478141784668,&#34;m12&#34;:-2.0802533626556396},&#34;opacity&#34;:1.0,&#34;blendMode&#34;:&#34;NORMAL&#34;,&#34;visible&#34;:true}"/>
            <defs>
            <clipPath id="paint0_angular_18466_16115_clip_path"><path d="M14.0013 27.4779C13.2764 27.4779 12.6888 26.8902 12.6888 26.1654C12.6888 25.4405 13.2764 24.8529 14.0013 24.8529V27.4779ZM7.15284 22.2647C7.6963 22.7443 7.74802 23.5738 7.26834 24.1172C6.78867 24.6607 5.95925 24.7124 5.41579 24.2327L7.15284 22.2647ZM14.0013 26.1654V24.8529C19.7197 24.8529 24.3555 20.2171 24.3555 14.4987H25.668H26.9805C26.9805 21.6669 21.1695 27.4779 14.0013 27.4779V26.1654ZM25.668 14.4987H24.3555C24.3555 8.78025 19.7197 4.14453 14.0013 4.14453V2.83203V1.51953C21.1695 1.51953 26.9805 7.3305 26.9805 14.4987H25.668ZM14.0013 2.83203V4.14453C8.28285 4.14453 3.64713 8.78025 3.64713 14.4987H2.33463H1.02213C1.02213 7.3305 6.83311 1.51953 14.0013 1.51953V2.83203ZM2.33463 14.4987H3.64713C3.64713 17.591 5.00108 20.3655 7.15284 22.2647L6.28431 23.2487L5.41579 24.2327C2.72342 21.8564 1.02213 18.3754 1.02213 14.4987H2.33463Z"/></clipPath></defs>
          </svg>`
}

// 短横线转大写
export const hyphenToUppercase = (str: string) => {
  return str
    .split('-')
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join('')
}

/** 字符串转确定性的 RGBA 颜色，alpha 默认 1（不透明） */
export function hexToRgba(hex: string, alpha: number = 1) {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    const [r, g, b] = h.split('')
    h = r + r + g + g + b + b
  }
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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
