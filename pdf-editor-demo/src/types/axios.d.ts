/**
 * axios 模块类型增强
 */

// 请求配置扩展字段（utils/request.ts 中 config._adminTokenRetried）
declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _adminTokenRetried?: boolean
  }
}

export {}
