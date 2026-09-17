/**
 * 无类型第三方模块的补丁声明
 * （本文件为全局脚本声明，勿加 import/export，避免 ambient 模块声明退化为模块增强）
 */

// vite-plugin-svg-icons 的虚拟模块（main.ts 中 import 'virtual:svg-icons-register'）
declare module 'virtual:svg-icons-register'

// pdfjs-dist worker bundle（官方构建无 .d.ts，仅供 fake-worker 注入 WorkerMessageHandler；legacy 路径与主库保持一致）
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: any
}
