// src/utils/axios.ts
import axios from 'axios'
import type {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
  AxiosResponse,
  AxiosRequestConfig
} from 'axios'
import { getToken, getOpenID } from '@/utils/webStorage'
import { handlerError } from '@/utils/handlerError'
import { postMessage } from '@/utils/tools'
import { getLanguage } from '@/language/index'
import { useManagementStore } from '@/store/management'
import { MANAGEMENT_TOKEN_URL } from '@/api/backend/userInfo'

class AxiosRequest {
  private axiosInstance: AxiosInstance

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: import.meta.env.VITE_API_BASE_URL,
      timeout: 5 * 60 * 1000, // 请求超时
      headers: {
        'Content-Type': 'application/json'
      }
    })

    // 请求拦截器
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const token = getToken()
        const openID = getOpenID()
        const lang = getLanguage(false)
        if (token && !config.headers['Authorization']) {
          config.headers['Authorization'] = `${token}`
        }
        openID && (config.headers['open-id'] = `${openID}`)
        lang && (config.headers['lang'] = `${lang}`)
        return config
      },
      (error: AxiosError) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器
    this.axiosInstance.interceptors.response.use(
      async (response: AxiosResponse<Global.ApiResponse>): Promise<AxiosResponse['data']> => {
        const { data, config } = response
        const { code } = data

        if (code === 200) {
          return data
        }

        // 无感刷新并重试原请求
        // if (!config._adminTokenRetried) {
        //   const mtStore = useManagementStore()
        //   mtStore.invalidateToken()
        //   config.headers['management-Token'] = await mtStore.ensureAdminToken()
        //   config._adminTokenRetried = true
        //   return this.axiosInstance.request(config)
        // }

        handlerError(data)
        return Promise.reject(data)
      },
      (error: any) => {
        console.error('error', error)
        // 统一错误处理
        let errorMessage = 'Request Failed'
        if (error.response) {
          errorMessage = error.response.data.message || error.response.data.error || 'Server Error'
        } else if (error.request) {
          errorMessage = 'Network Error'
        } else {
          errorMessage = error.message
        }
        postMessage('error', errorMessage)
        return Promise.reject(new Error(errorMessage))
      }
    )
  }

  public request<T = any>(config: AxiosRequestConfig): Promise<Global.ApiResponse<T>> {
    /**
     * TODO: execute other methods according to config
     */
    return new Promise((resolve, reject) => {
      try {
        this.axiosInstance
          .request<Global.ApiResponse<T>>(config)
          .then((res: AxiosResponse['data']) => {
            resolve(res as Global.ApiResponse<T>)
          })
          .catch((err) => {
            reject(err)
          })
      } catch (err) {
        return Promise.reject(err)
      }
    })
  }

  // 封装 GET 请求
  public get<T = any>(config: AxiosRequestConfig): Promise<Global.ApiResponse<T>> {
    return this.request({ method: 'get', ...config })
  }

  // 封装 POST 请求
  public post<T = any>(config: AxiosRequestConfig): Promise<Global.ApiResponse<T>> {
    return this.request({ method: 'post', ...config })
  }

  // 封装 PUT 请求
  public put<T = any>(config: AxiosRequestConfig): Promise<Global.ApiResponse<T>> {
    return this.request({ method: 'put', ...config })
  }

  // 封装 DELETE 请求
  public delete<T = any>(config: AxiosRequestConfig): Promise<Global.ApiResponse<T>> {
    return this.request({ method: 'delete', ...config })
  }
}

// 创建一个 AxiosRequest 实例
const axiosRequest = new AxiosRequest()
export default axiosRequest
