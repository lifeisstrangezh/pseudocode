/**
 * 全局命名空间类型声明（用法：Global.AnyObject / Global.LangType / Global.ApiResponse）
 */

declare global {
  namespace Global {
    type AnyObject = Record<string, any>

    type LangType =
      | 'en'
      | 'zh-cn'
      | 'zh-tw'
      | 'ja'
      | 'pt'
      | 'es'
      | 'ko'
      | 'th'
      | 'fr'
      | 'it'
      | 'ar'
      | 'tr'
      | 'id'
      | 'hi'
      | 'ms'
      | 'tw'
      | 'jp'
      | 'br'
      | 'kr'
      | 'my'

    interface ApiResponse<T = any> {
      code: number
      message?: string
      msg?: string
      data: T
      [key: string]: any
    }
  }
}

export {}
