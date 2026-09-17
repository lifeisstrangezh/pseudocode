/**
 * 字节预算 LRU 位图缓存。
 *
 * - 键为 `${page}@${scaleBucket}`：左右两侧分辨率不同，各存各的位图。
 * - 命中即刷新到队尾（Map 的迭代序天然就是插入序，删后重插即 LRU）。
 * - 超出字节预算时淘汰最久未用项，并立即 `bitmap.close()` 释放底层内存/显存。
 */

/** 估算 ImageBitmap 占用字节：宽 × 高 × 4（RGBA） */
const bitmapBytes = (bm: ImageBitmap) => bm.width * bm.height * 4

export class BitmapCache {
  /** Map 保持插入序，迭代第一个即最久未用 */
  private map = new Map<string, ImageBitmap>()
  private bytes = 0

  /** 默认 256MB（300% A4 单页约 35MB，可容纳约 7 张满缩放 + 大量缩略图） */
  constructor(private budgetBytes = 256 * 1024 * 1024) {}

  get(key: string): ImageBitmap | undefined {
    const bm = this.map.get(key)
    if (bm) {
      // 命中 → 移到队尾，标记为最近使用
      this.map.delete(key)
      this.map.set(key, bm)
    }
    return bm
  }

  has(key: string) {
    return this.map.has(key)
  }

  set(key: string, bm: ImageBitmap) {
    const existing = this.map.get(key)
    if (existing) {
      this.bytes -= bitmapBytes(existing)
      existing.close()
      this.map.delete(key)
    }
    this.map.set(key, bm)
    this.bytes += bitmapBytes(bm)
    this.evict()
  }

  /** 删除并关闭指定键 */
  delete(key: string) {
    const bm = this.map.get(key)
    if (bm) {
      this.bytes -= bitmapBytes(bm)
      bm.close()
      this.map.delete(key)
    }
  }

  /** 超预算时淘汰最久未用（至少保留 1 张，避免刚渲染好就被自己挤掉） */
  private evict() {
    while (this.bytes > this.budgetBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string
      this.delete(oldest)
    }
  }

  clear() {
    for (const bm of this.map.values()) bm.close()
    this.map.clear()
    this.bytes = 0
  }
}
