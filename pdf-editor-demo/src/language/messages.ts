// 递归删除空词条的函数
const removeEmptyEntries = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return undefined
  }

  if (typeof obj !== 'object' || Array.isArray(obj)) {
    // 如果是空字符串，返回undefined以便删除
    return obj === '' ? undefined : obj
  }

  const result: any = {}
  let hasValidEntries = false

  for (const [key, value] of Object.entries(obj)) {
    const cleanedValue = removeEmptyEntries(value)
    if (cleanedValue !== undefined) {
      result[key] = cleanedValue
      hasValidEntries = true
    }
  }

  // 如果对象没有有效的条目，返回undefined
  return hasValidEntries ? result : undefined
}

// 动态导入语言包的函数
const loadLanguageMessages = async (lang: string) => {
  try {
    // 语言映射表，将语言代码映射到对应的文件夹
    const langMap: Record<string, string> = {
      'zh-cn': 'zh',
      'zh-tw': 'tw',
      en: 'en',
      ja: 'ja',
      pt: 'pt', // 巴西语使用pt文件夹
      es: 'es',
      ko: 'ko',
      th: 'th',
      fr: 'fr',
      it: 'it',
      ar: 'ar',
      tr: 'tr',
      id: 'id',
      hi: 'hi',
      ms: 'ms'
    }

    // 获取实际的文件夹名称，如果没有映射则使用原语言代码
    const folderName = langMap[lang] || 'en' // 默认使用en作为保底

    // 动态导入所有模块
    const [common, cloud, convert, home, task, errorCode, seo] = await Promise.all([
      import(`./locales/${folderName}/common.json`).catch(() => import('./locales/en/common.json')),
      import(`./locales/${folderName}/cloud.json`).catch(() => import('./locales/en/cloud.json')),
      import(`./locales/${folderName}/convert.json`).catch(
        () => import('./locales/en/convert.json')
      ),
      import(`./locales/${folderName}/home.json`).catch(() => import('./locales/en/home.json')),
      import(`./locales/${folderName}/task.json`).catch(() => import('./locales/en/task.json')),
      import(`./locales/${folderName}/errorCode.json`).catch(
        () => import('./locales/en/errorCode.json')
      ),
      import(`./locales/${folderName}/seo.json`).catch(() => import('./locales/en/seo.json'))
    ])

    const messages = {
      ...common.default,
      ...cloud.default,
      ...convert.default,
      ...home.default,
      ...task.default,
      ...errorCode.default,
      ...seo.default
    }

    // 删除空词条，让vue-i18n的fallback机制正确工作
    return removeEmptyEntries(messages) || {}
  } catch (error) {
    console.warn(`Failed to load language ${lang}, falling back to English`, error)
    // 如果加载失败，返回英文作为保底
    if (lang !== 'en') {
      return await loadLanguageMessages('en')
    }

    // 如果连英文都加载失败，返回空对象
    return {}
  }
}

// 根据当前语言动态加载消息
export const loadMessages = async (currentLang: string) => {
  const currentMessages = await loadLanguageMessages(currentLang)
  // 始终加载英文作为fallback语言
  const enMessages = await loadLanguageMessages('en')

  const result: Record<string, any> = {
    en: enMessages
  }

  // 如果当前语言不是英文，则加载当前语言的消息
  if (currentLang !== 'en') {
    result[currentLang] = currentMessages
  }

  return result
}

// 为了保持向后兼容，先导出一个默认的messages（使用英文）
export const messages = {}
