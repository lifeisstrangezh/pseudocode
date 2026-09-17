import { createVNode, render, type Component, type VNode } from 'vue'
import { getAppInstance } from '@/utils/appInstance'

interface MountOptions<Props extends Record<string, any> = Record<string, any>> {
  props?: Props
  container?: HTMLElement
}

interface MountResult {
  vnode: VNode
  container: HTMLElement
  unmount: () => void
}

/**
 * 动态挂载 Vue 组件到 DOM，复用主应用的 appContext，共享上下文
 * @param component - 要挂载的 Vue 组件
 * @param options - 可选配置，包含 props 和 container
 * @returns { vnode, container, unmount } - 调用 unmount() 卸载组件并移除 DOM 节点
 */
export function mountComponent<Props extends Record<string, any>>(
  component: Component,
  options: MountOptions<Props> = {}
): MountResult {
  const container = options.container || document.createElement('div')
  if (!options.container) {
    document.body.appendChild(container)
  }

  const vnode = createVNode(component, options.props)
  vnode.appContext = getAppInstance()._context

  render(vnode, container)

  const unmount = () => {
    render(null, container)
    if (!options.container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  return { vnode, container, unmount }
}
