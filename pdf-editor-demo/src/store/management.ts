import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAdminToken } from '@/api/backend/userInfo'
import { getLocalStorage, setLocalStorage } from '@/utils/webStorage'

/** manage-Token localStorage 键名 */
const TOKEN_KEY = 'mgmt-manage-Token'
/** manage-Token 过期时间 localStorage 键名 */
const TOKEN_EXPIRES_KEY = 'mgmt-manage-Token-expires'
/** manage-Token 有效期：6小时 */
const TOKEN_TTL = 6 * 60 * 60 * 1000

/**
 * 后台管理 Store
 *
 * 管理后台页面的数据源切换和 manage-Token 生命周期。
 * 国内数据源需要在所有后台请求头带上 manage-Token，Token 有效期 6 小时。
 *
 * Token 刷新采用「单次飞行」模式（single-flight）：
 * 多个并发请求同时发现 Token 过期时，只有一个请求会真正去获取新 Token，
 * 其他请求共享同一个 Promise 结果。
 */
export const useManagementStore = defineStore('management', () => {
  /** 缓存的 manage-Token (admin是关键字，换成manage相关字眼) */
  const adminToken = ref<string>(getLocalStorage(TOKEN_KEY, ''))
  /** Token 过期时间戳（ms） */
  const tokenExpiresAt = ref<number>(getLocalStorage(TOKEN_EXPIRES_KEY, 0))
  const isDomestic = true // TODO
  /**
   * 并发锁：同一时间只允许一个 fetchAdminToken 请求在进行
   * 使用闭包变量而非 ref，避免触发不必要的响应式更新
   */
  let _tokenPromise: Promise<string> | null = null

  /** 本地判断 Token 是否已过期 */
  function isTokenExpired() {
    return Date.now() >= tokenExpiresAt.value
  }

  /** 请求后端获取新的 manage-Token */
  async function fetchAdminToken(): Promise<string> {
    const res = await getAdminToken()
    const token = res.data.token
    const expiresAt = Date.now() + TOKEN_TTL
    adminToken.value = token
    tokenExpiresAt.value = expiresAt
    setLocalStorage(TOKEN_KEY, token)
    setLocalStorage(TOKEN_EXPIRES_KEY, expiresAt)
    return token
  }

  /**
   * 确保 manage-Token 有效
   *
   * 单次飞行模式入口：
   * 1. 如果有正在进行的获取请求 → 复用其 Promise
   * 2. 如果缓存的 Token 未过期 → 直接返回
   * 3. 否则 → 发起新的获取请求
   */
  async function ensureAdminToken(): Promise<string> {
    if (_tokenPromise) {
      return _tokenPromise
    }
    if (adminToken.value && !isTokenExpired()) {
      return adminToken.value
    }
    _tokenPromise = fetchAdminToken().finally(() => {
      _tokenPromise = null
    })
    return _tokenPromise
  }

  /**
   * 主动标记当前 Token 失效
   *
   * 由错误触发。仅在没有正在进行的获取请求时才置零过期时间，
   * 避免覆盖正在获取的新 Token 信息。
   */
  function invalidateToken() {
    if (!_tokenPromise) {
      tokenExpiresAt.value = 0
    }
  }

  /** 清除 manage-Token 缓存（退出登录时调用） */
  function clearAdminToken() {
    adminToken.value = ''
    tokenExpiresAt.value = 0
    setLocalStorage(TOKEN_KEY, '')
    setLocalStorage(TOKEN_EXPIRES_KEY, 0)
  }

  return {
    adminToken,
    tokenExpiresAt,
    isDomestic,
    isTokenExpired,
    ensureAdminToken,
    invalidateToken,
    clearAdminToken
  }
})
