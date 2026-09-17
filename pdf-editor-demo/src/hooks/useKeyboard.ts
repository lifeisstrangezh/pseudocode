import {
  shallowRef,
  isRef,
  onMounted,
  onUnmounted,
  watch,
  computed,
  type Ref,
  type ComputedRef,
  type MaybeRef,
  toValue
} from 'vue'
import { getSystemAndBrowser } from '@/utils/tools'

/** macOS 或 iOS */
const isMac = (): boolean => ['MacOS', 'IOS'].includes(getSystemAndBrowser())

/** 平台感知主修饰键别名：Mac → Cmd, Win/Linux → Ctrl */
const CTRL_ALIASES = new Set(['ctrl', 'control', 'mod'])
const SHIFT_ALIASES = new Set(['shift'])
const ALT_ALIASES = new Set(['alt', 'option'])
const META_ALIASES = new Set(['meta', 'cmd', 'command', 'win', 'windows'])

/** KeyboardEvent.key → 归一化键名 */
const NORMALIZED_KEYS: Record<string, string> = {
  Shift: 'Shift',
  Control: 'Control',
  Alt: 'Alt',
  Meta: 'Meta',
  ' ': 'Space',
  space: 'Space'
}

/** 快捷键修饰键 → 展示文本 */
const DISPLAY_MAP: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Meta',
  cmd: 'Cmd',
  command: 'Cmd',
  win: 'Win',
  windows: 'Win'
}

/** useKeyboard 配置项 */
export interface UseKeyboardOptions {
  /** 事件绑定的目标元素，默认 document。支持传入 Vue 组件 ref（自动取其 $el）或 DOM 元素 */
  target?: MaybeRef<EventTarget | null | { $el: EventTarget | null }>
  /** 是否启用键盘追踪，默认 true */
  enabled?: MaybeRef<boolean>
}

/** 快捷键绑定描述 */
export interface KeyBinding {
  /** 快捷键组合，如 'ctrl+s', 'shift+a', 'escape'。ctrl 自动平台适配：Win/Linux 映射为 Ctrl，Mac 映射为 Cmd */
  keys: string
  /** 触发回调，接收原始 KeyboardEvent */
  handler: (e: KeyboardEvent) => void
  /** 是否阻止浏览器默认行为，默认 false */
  preventDefault?: boolean
}

/** useKeyboard 返回值 */
export interface UseKeyboardReturn {
  /** 当前按下的键名集合（只读响应式），key 格式: 首字母大写（'Shift', 'Control', 'Alt', 'Meta'），其他键小写 */
  pressedKeys: Ref<ReadonlySet<string>>
  /** 查询某键是否处于按下状态，内部做归一化匹配 */
  isPressed: (key: string) => boolean
  /** Shift 键是否按下 */
  isShift: ComputedRef<boolean>
  /** Ctrl 键是否按下 */
  isCtrl: ComputedRef<boolean>
  /** Alt/Option 键是否按下 */
  isAlt: ComputedRef<boolean>
  /** Meta/Cmd 键是否按下 */
  isMeta: ComputedRef<boolean>
  /** 平台主修饰键是否按下：Mac 为 Cmd(Meta)，Win/Linux 为 Ctrl */
  isMod: ComputedRef<boolean>
  /** 注册 keydown 快捷键，返回取消注册函数 */
  shortcut: (
    keys: string,
    handler: (e: KeyboardEvent) => void,
    preventDefault?: boolean
  ) => () => void
  /** 批量注册快捷键，返回统一取消函数 */
  shortcuts: (bindings: KeyBinding[]) => () => void
  /** 格式化快捷键为平台文本（如 formatShortcut('ctrl+s') → Win: 'Ctrl+S', Mac: 'Cmd+S'），用于 UI 展示 */
  formatShortcut: (combo: string) => string
}

/**
 * 将 KeyboardEvent.key 归一化为一致的键名
 * - 修饰键首字母大写: Shift, Control, Alt, Meta
 * - 特殊键统一: ' ' / 'space' → Space
 * - 其他键转小写
 */
const normalizeKey = (key: string): string => {
  if (!key) return ''
  return NORMALIZED_KEYS[key] ?? key.toLowerCase()
}

/**
 * 解析快捷键字符串（如 'ctrl+shift+s'）为修饰键位掩码 + 目标键
 * `ctrl` / `control` / `mod` 是平台感知的主修饰键别名：Win/Linux → Ctrl，macOS → Cmd(Meta)
 * 也支持 Mac 的 `option` 作为 `alt` 的别名
 * 返回 null 表示解析失败（如缺少非修饰键）
 */
const parseKeyCombo = (combo: string) => {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  const modifiers = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false
  }
  const keys: string[] = []

  for (const part of parts) {
    if (CTRL_ALIASES.has(part)) {
      // 平台感知主修饰键：Mac → Cmd, Win/Linux → Ctrl
      if (isMac()) modifiers.meta = true
      else modifiers.ctrl = true
    } else if (SHIFT_ALIASES.has(part)) {
      modifiers.shift = true
    } else if (ALT_ALIASES.has(part)) {
      modifiers.alt = true
    } else if (META_ALIASES.has(part)) {
      modifiers.meta = true
    } else {
      keys.push(part)
    }
  }

  if (keys.length !== 1) return null // 必须恰好一个非修饰键
  return { ...modifiers, key: normalizeKey(keys[0]) }
}

/**
 * 匹配键盘事件是否满足指定的快捷键组合
 * 平台兼容：当 combo 使用 `ctrl`/`mod` 时，由 parseKeyCombo 自动适配平台
 */
const matchKeyCombo = (e: KeyboardEvent, combo: string): boolean => {
  const parsed = parseKeyCombo(combo)
  if (!parsed) return false
  if (e.ctrlKey !== parsed.ctrl) return false
  if (e.shiftKey !== parsed.shift) return false
  if (e.altKey !== parsed.alt) return false
  if (e.metaKey !== parsed.meta) return false
  return normalizeKey(e.key) === parsed.key
}

/**
 * 通用键盘状态跟踪与快捷键注册 Composable
 *
 * 提供两个正交的能力：
 * 1. **状态跟踪** — `pressedKeys` / `isPressed` / `isShift` 等，用于修饰键+鼠标组合场景（如 Shift+click 范围选中）
 * 2. **快捷键注册** — `shortcut` / `shortcuts`，用于纯键盘快捷键场景（如 ctrl+s 保存）
 *
 * 两者共用同一组 keydown/keyup 监听器，避免重复绑定。
 *
 * 快捷键字符串中的 `ctrl` 自动平台适配：
 * - Win/Linux: `ctrl` → Ctrl
 * - macOS: `ctrl` → Cmd
 *
 * `formatShortcut(combo)` 获取展示文本，同样平台自适应。
 *
 * @example 修饰键跟踪（Shift+click 范围选中）
 * const { isPressed } = useKeyboard()
 * // click 事件中: if (isPressed('Shift')) {}
 *
 * @example 跨平台快捷键注册 + 展示
 * const { shortcut, formatShortcut } = useKeyboard()
 * shortcut('ctrl+s', () => save())       // Win: Ctrl+S, Mac: Cmd+S
 * shortcut('ctrl+shift+z', () => redo())
 * const hint = formatShortcut('ctrl+s')  // 'Ctrl+S' or 'Cmd+S' — 直接用作文本
 *
 * @example 阻止浏览器默认行为（如 Ctrl+S 保存对话框）
 * shortcut('ctrl+s', () => saveToCloud(), true) // 第三个参数 preventDefault
 * // 或批量注册:
 * shortcuts([
 *   { keys: 'ctrl+s', handler: () => saveToCloud(), preventDefault: true },
 *   { keys: 'ctrl+z', handler: () => undo() },
 * ])
 */
export function useKeyboard(options: UseKeyboardOptions = {}): UseKeyboardReturn {
  const { target, enabled = true } = options

  /** 当前按下的键名集合（shallowRef + Set 减少响应式追踪开销） */
  const pressedKeys = shallowRef<Set<string>>(new Set())

  /** 已注册的快捷键列表 */
  const registeredShortcuts: Array<{
    combo: string
    handler: (e: KeyboardEvent) => void
    preventDefault: boolean
  }> = []

  // 处理 enabled 的 MaybeRef
  let enabledValue = toValue(enabled) ?? true
  const unwatchEnabled = isRef(enabled)
    ? watch(
        () => toValue(enabled),
        (val) => {
          enabledValue = val ?? true
        }
      )
    : null

  // ---- keydown 处理器 ----
  const handleKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent

    // 忽略 IME 输入中的键盘事件（如中文拼音）
    if (ke.isComposing) return

    // 1. 更新 pressedKeys 状态
    const keyName = normalizeKey(ke.key)
    if (keyName) {
      const current = pressedKeys.value
      if (!current.has(keyName)) {
        const next = new Set(current)
        next.add(keyName)
        pressedKeys.value = next
      }
    }

    // 2. 检查是否触发已注册的快捷键
    if (!enabledValue) return
    for (const entry of registeredShortcuts) {
      if (matchKeyCombo(ke, entry.combo)) {
        if (entry.preventDefault) ke.preventDefault()
        entry.handler(ke)
      }
    }
  }

  // ---- keyup 处理器 ----
  const handleKeyUp = (e: Event) => {
    const ke = e as KeyboardEvent
    const keyName = normalizeKey(ke.key)
    if (keyName && pressedKeys.value.has(keyName)) {
      const next = new Set(pressedKeys.value)
      next.delete(keyName)
      pressedKeys.value = next
    }
  }

  let boundTarget: EventTarget | null = null

  const getTarget = (): EventTarget => {
    const raw = toValue(target)
    if (!raw) return document
    // Vue 组件实例：取其根 DOM 元素
    if ('$el' in raw) return raw.$el ?? document
    return raw as EventTarget
  }

  const bind = () => {
    boundTarget = getTarget()
    boundTarget.addEventListener('keydown', handleKeyDown)
    boundTarget.addEventListener('keyup', handleKeyUp)
  }

  const unbind = () => {
    if (boundTarget) {
      boundTarget.removeEventListener('keydown', handleKeyDown)
      boundTarget.removeEventListener('keyup', handleKeyUp)
      boundTarget = null
    }
    pressedKeys.value.clear()
    registeredShortcuts.length = 0
  }

  const isPressed = (key: string) => pressedKeys.value.has(normalizeKey(key))
  const isShift = computed(() => pressedKeys.value.has('Shift'))
  const isCtrl = computed(() => pressedKeys.value.has('Control'))
  const isAlt = computed(() => pressedKeys.value.has('Alt'))
  const isMeta = computed(() => pressedKeys.value.has('Meta'))
  /** 平台感知主修饰键：Mac → Cmd, Win/Linux → Ctrl */
  const isMod = computed(() =>
    isMac() ? pressedKeys.value.has('Meta') : pressedKeys.value.has('Control')
  )

  const shortcut = (
    keys: string,
    handler: (e: KeyboardEvent) => void,
    preventDefault = false
  ): (() => void) => {
    const entry = {
      combo: keys.toLowerCase(),
      handler,
      preventDefault
    }
    registeredShortcuts.push(entry)
    return () => {
      const idx = registeredShortcuts.indexOf(entry)
      if (idx !== -1) registeredShortcuts.splice(idx, 1)
    }
  }

  const shortcuts = (bindings: KeyBinding[]): (() => void) => {
    const unregs = bindings.map((b) => shortcut(b.keys, b.handler, b.preventDefault))
    return () => unregs.forEach((fn) => fn())
  }

  /**
   * 格式化快捷键组合为平台文本，用于 UI 展示
   * `ctrl` / `mod` → Win: 'Ctrl', Mac: 'Cmd'
   * 其余修饰键首字母大写，主键转大写
   */
  const formatShortcut = (combo: string): string => {
    const parts = combo
      .toLowerCase()
      .split('+')
      .map((s) => s.trim())
      .filter(Boolean)
    return parts
      .map((part) => {
        // 平台感知：ctrl/control/mod 在 Mac 上显示为 Cmd
        if (CTRL_ALIASES.has(part) && isMac()) return 'Cmd'
        return DISPLAY_MAP[part] ?? part.toUpperCase()
      })
      .join('+')
  }

  onMounted(bind)

  onUnmounted(() => {
    unbind()
    unwatchEnabled?.()
  })

  return {
    pressedKeys,
    isPressed,
    isShift,
    isCtrl,
    isAlt,
    isMeta,
    isMod,
    shortcut,
    shortcuts,
    formatShortcut
  }
}
