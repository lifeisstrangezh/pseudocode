import { createI18n } from 'vue-i18n'
import { messages, loadMessages } from './messages'
import eventBus from '@/utils/eventBus'
import Cookies from 'js-cookie'
import { LangEnum } from '@/utils/enums'

export const languageOptions: any[] = [
  {
    value: 'en',
    label: 'English' // 英语
  },
  // {
  //   value: 'zh-tw',
  //   label: 'Traditional Chinese' // 繁体中文
  // },
  // {
  //   value: 'zh-cn',
  //   label: 'Simplified Chinese' // 简体中文
  // },
  // {
  //   value: 'ja',
  //   label: 'Japanese' // 日语
  // },
  // {
  //   value: 'pt',
  //   label: 'Brazilian' // 巴西语
  // },
  // {
  //   value: 'es',
  //   label: 'Spanish' // 西班牙语
  // },
  // {
  //   value: 'ko',
  //   label: 'Korean' // 韩语
  // },
  // {
  //   value: 'th',
  //   label: 'Thai' // 泰国语
  // },
  // {
  //   value: 'fr',
  //   label: 'French' // 法语
  // },
  // {
  //   value: 'it',
  //   label: 'Italy' // 意大利语
  // },
  // // ar需要特殊处理:ar-SA、ar-EG
  // {
  //   value: 'ar',
  //   label: 'Arabic' // 阿拉伯语
  // },
  // {
  //   value: 'tr',
  //   label: 'Turkish' // 土耳其语
  // },
  // {
  //   value: 'id',
  //   label: 'Indonesia' // 印度尼西亚语
  // },
  // {
  //   value: 'hi',
  //   label: 'Hindi' // 印地语
  // },
  // {
  //   value: 'ms',
  //   label: 'Malay' // 马来语
  // }
]

let needChangeLang = false

// 由于运营与中台缩写不一致，需要映射
export const replaceLang: Partial<Record<Global.LangType, Global.LangType>> = {
  tw: LangEnum.ZhTw,
  jp: LangEnum.Ja,
  br: LangEnum.Pt,
  kr: LangEnum.Ko,
  my: 'ms'
}

export const supportedLangs = languageOptions
  .map((item) => item.value)
  .filter((item) => item !== 'zh-cn')

/**
 * 从 URL 路径解析语言，统一处理三种情况：
 * 1. 受支持语种 → 直接返回
 * 2. 语种别名（tw/jp/br/kr/my）→ 重定向到规范语种
 * 3. 未知语种 → 重定向到英语路径（去掉语言前缀）
 */
const resolveLangFromPath = () => {
  const { pathname, search, hash } = window.location
  const parts = pathname.split('/').filter(Boolean) // eg: ['en', 'pdf-editor']
  const firstSegment = parts[0]
  const domainUrl = import.meta.env.VITE_DOMAIN_URL
  const domainFirstSegment = domainUrl.split('/').filter(Boolean)[0]

  // 受支持的语种（非英语）
  if (supportedLangs.includes(firstSegment) && firstSegment !== 'en') {
    return {
      lang: firstSegment,
      basePath: `/${firstSegment}${domainUrl}`
    }
  }

  // 第一个段不是域名路径（如 pdf-editor），说明可能是语种前缀
  if (firstSegment && firstSegment !== domainFirstSegment) {
    const pathWitchSearchHash = `${parts.slice(1).join('/')}${search}${hash}`
    const canonicalLang = replaceLang[firstSegment as Global.LangType]
    // 语种别名 → 重定向到规范语种，如 /tw/pdf-editor/home → /zh-tw/pdf-editor/home
    // 未知语种 → 回退英语，去掉语言前缀，如 /xx/pdf-editor/home → /pdf-editor/home
    const redirectPath = canonicalLang
      ? `/${canonicalLang}/${pathWitchSearchHash}`
      : `/${pathWitchSearchHash}`
    window.location.replace(redirectPath)
  }

  // 英语或重定向中的临时默认值
  return {
    lang: LangEnum.En,
    basePath: domainUrl
  }
}

const { lang: resolvedLang, basePath: resolvedBasePath } = resolveLangFromPath()

export const currentLang = resolvedLang as Global.LangType
export const basePath = resolvedBasePath

// 根据当前系统语言返回匹配的语言字符串
export const getMatchLanguage = (): Global.LangType => {
  return 'en'
}

export const matchLanguage = getMatchLanguage()

// 创建 i18n 实例
const i18n = createI18n({
  legacy: false, // 使用 Composition API 需要设置为 false
  globalInjection: true, // 允许全局使用 $t
  locale: matchLanguage, // 默认语言
  fallbackLocale: 'en', // 备用语言
  messages, // 初始为空，稍后动态加载
  missingWarn: false, // 关闭缺失翻译时的警告
  fallbackWarn: false, // 关闭回退到备用语言时的警告
  silentTranslationWarn: true // 静默翻译警告
})

// 动态加载语言包
const initializeMessages = async () => {
  try {
    const currentLanguage = matchLanguage
    const loadedMessages = await loadMessages(currentLanguage)
    // 更新 i18n 实例的消息
    Object.keys(loadedMessages).forEach((lang) => {
      i18n.global.setLocaleMessage(lang, loadedMessages[lang])
    })
    // 设置备选语言为英语
    i18n.global.fallbackLocale.value = 'en'
    // 设置当前语言
    i18n.global.locale.value = currentLanguage
  } catch (error) {
    console.error('Failed to initialize messages:', error)
    // 如果加载失败，至少加载英文
    try {
      const enMessages = await loadMessages('en')
      i18n.global.setLocaleMessage('en', enMessages.en)
      i18n.global.locale.value = 'en'
    } catch (fallbackError) {
      console.error('Failed to load fallback English messages:', fallbackError)
    }
  }
}

// 导出初始化函数，供应用启动时调用
export const initializeI18n = async () => {
  await initializeMessages()
  return i18n
}

// 立即初始化消息（保持向后兼容）
;(async () => {
  await initializeMessages()
  // 需要修改地址语言
  if (!needChangeLang) {
    eventBus.emit('languageLoaded')
  }
})()

export const changeLanguage = async (lang: Global.LangType) => {
  try {
    // 动态加载新语言的消息
    const loadedMessages = await loadMessages(lang)
    // 更新 i18n 实例的消息
    Object.keys(loadedMessages).forEach((locale) => {
      i18n.global.setLocaleMessage(locale, loadedMessages[locale])
    })
    // 设置当前语言
    i18n.global.locale.value = lang
  } catch (error) {
    console.error(`Failed to load language ${lang}:`, error)
    // 如果加载失败，仍然尝试切换到该语言（可能已经有缓存的消息）
    i18n.global.locale.value = lang
  }
}

export const getLanguage = (needReplace = true) => {
  let lang = i18n.global.locale.value
  if (needReplace) {
    // 存在替换值则替换
    const replaceLangVal = Object.entries(replaceLang)
    for (const [key, value] of replaceLangVal) {
      if (value === lang) {
        lang = key
      }
    }
  }
  return lang
}

export const catchLanguage = () => {
  localStorage.setItem('language', getLanguage())
}
catchLanguage()

export default i18n
