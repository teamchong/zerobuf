/**
 * Arena allocator over WebAssembly.Memory.
 *
 * Bump allocator with alignment support. Grows WASM memory using a
 * doubling strategy to amortize grow costs. Each memory.grow() detaches
 * the ArrayBuffer, so we cache the DataView and invalidate on grow.
 *
 * No free — arena is append-only. For realloc, we allocate new and abandon
 * old (fragmentation is acceptable for the use case).
 */

/** WASM memory max: 65536 pages × 64KB = 4GB */
const MAX_PAGES = 65536;
const PAGE_SIZE = 65536; // 64KB

export interface ArenaOptions {
  /**
   * Maximum number of WASM pages to allow (default: 65536 = 4GB).
   * Set lower to bound memory usage.
   */
  maxPages?: number;
}

export class Arena {
  private _memory: WebAssembly.Memory;
  private _offset: number;
  private _maxPages: number;
  private _view: DataView | null = null;
  private _currentBuffer: ArrayBuffer | null = null;

  constructor(memory: WebAssembly.Memory, startOffset = 0, options?: ArenaOptions) {
    this._memory = memory;
    this._offset = startOffset;
    this._maxPages = options?.maxPages ?? MAX_PAGES;
  }

  get memory(): WebAssembly.Memory {
    return this._memory;
  }

  get offset(): number {
    return this._offset;
  }

  get buffer(): ArrayBuffer {
    return this._memory.buffer;
  }

  /** Current memory size in bytes */
  get size(): number {
    return this._memory.buffer.byteLength;
  }

  /** Current memory size in pages */
  get pages(): number {
    return this._memory.buffer.byteLength / PAGE_SIZE;
  }

  /** Bytes remaining before hitting max */
  get remaining(): number {
    return this._maxPages * PAGE_SIZE - this._offset;
  }

  /** Allocate `bytes` with given alignment. Returns byte offset in memory. */
  alloc(bytes: number, align = 4): number {
    // Align up
    this._offset = (this._offset + align - 1) & ~(align - 1);
    const ptr = this._offset;
    this._offset += bytes;

    // Grow memory if needed
    const needed = this._offset;
    const available = this._memory.buffer.byteLength;
    if (needed > available) {
      this._grow(needed);
    }

    return ptr;
  }

  /** Allocate and copy bytes. Returns offset. */
  allocBytes(data: Uint8Array, align = 1): number {
    const ptr = this.alloc(data.byteLength, align);
    new Uint8Array(this._memory.buffer, ptr, data.byteLength).set(data);
    return ptr;
  }

  /**
   * Grow memory to fit at least `needed` bytes.
   *
   * Strategy: double current size, but at least enough for `needed`.
   * This amortizes grow cost — each grow() detaches the ArrayBuffer
   * and invalidates all TypedArray views. Doubling means O(log n) grows
   * total instead of O(n).
   */
  private _grow(needed: number): void {
    const current = this._memory.buffer.byteLength;

    // Double, or the exact amount needed, whichever is larger
    const target = Math.max(needed, current * 2);
    const targetPages = Math.ceil(target / PAGE_SIZE);
    const currentPages = current / PAGE_SIZE;
    let newPages = targetPages - currentPages;

    if (newPages <= 0) return;

    // Clamp to max
    if (currentPages + newPages > this._maxPages) {
      newPages = this._maxPages - currentPages;
      if (newPages <= 0) {
        throw new RangeError(
          `zerobuf: out of memory. Need ${needed} bytes, max is ${this._maxPages * PAGE_SIZE} bytes (${this._maxPages} pages). ` +
            `Set maxPages in ArenaOptions to increase the limit, or reduce allocations.`,
        );
      }
      // Check if clamped growth is enough
      if ((currentPages + newPages) * PAGE_SIZE < needed) {
        throw new RangeError(
          `zerobuf: out of memory. Need ${needed} bytes, max is ${this._maxPages * PAGE_SIZE} bytes (${this._maxPages} pages).`,
        );
      }
    }

    const result = this._memory.grow(newPages);
    if (result === -1) {
      throw new RangeError(
        `zerobuf: memory.grow(${newPages}) failed. Current: ${currentPages} pages, requested: ${newPages} additional pages.`,
      );
    }

    // Invalidate cached view — buffer is detached after grow
    this._view = null;
    this._currentBuffer = null;
  }

  /**
   * Cached DataView — avoids creating a new DataView on every read/write.
   * Invalidated automatically when memory grows (buffer detaches).
   */
  private _getView(): DataView {
    const buf = this._memory.buffer;
    if (this._view === null || this._currentBuffer !== buf) {
      this._view = new DataView(buf);
      this._currentBuffer = buf;
    }
    return this._view;
  }

  // --- Read/write primitives (use cached DataView) ---

  readU32(offset: number): number {
    return this._getView().getUint32(offset, true);
  }

  writeU32(offset: number, value: number): void {
    this._getView().setUint32(offset, value, true);
  }

  readF64(offset: number): number {
    return this._getView().getFloat64(offset, true);
  }

  writeF64(offset: number, value: number): void {
    this._getView().setFloat64(offset, value, true);
  }

  readI32(offset: number): number {
    return this._getView().getInt32(offset, true);
  }

  writeI32(offset: number, value: number): void {
    this._getView().setInt32(offset, value, true);
  }

  readU8(offset: number): number {
    return this._getView().getUint8(offset);
  }

  writeU8(offset: number, value: number): void {
    this._getView().setUint8(offset, value);
  }
}
