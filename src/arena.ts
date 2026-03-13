/**
 * Arena allocator over WebAssembly.Memory.
 *
 * Bump allocator with alignment support. Grows WASM memory when needed.
 * No free — arena is append-only. For realloc, we allocate new and abandon old
 * (fragmentation is acceptable for the use case).
 */
export class Arena {
  private _memory: WebAssembly.Memory;
  private _offset: number;

  constructor(memory: WebAssembly.Memory, startOffset = 0) {
    this._memory = memory;
    this._offset = startOffset;
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
      const pages = Math.ceil((needed - available) / 65536);
      this._memory.grow(pages);
    }

    return ptr;
  }

  /** Allocate and copy bytes. Returns offset. */
  allocBytes(data: Uint8Array, align = 1): number {
    const ptr = this.alloc(data.byteLength, align);
    new Uint8Array(this._memory.buffer, ptr, data.byteLength).set(data);
    return ptr;
  }

  /** DataView over current buffer (recreated on each call since buffer can detach on grow) */
  view(): DataView {
    return new DataView(this._memory.buffer);
  }

  /** Uint8Array over current buffer */
  bytes(): Uint8Array {
    return new Uint8Array(this._memory.buffer);
  }

  /** Read u32 at offset */
  readU32(offset: number): number {
    return this.view().getUint32(offset, true);
  }

  /** Write u32 at offset */
  writeU32(offset: number, value: number): void {
    this.view().setUint32(offset, value, true);
  }

  /** Read f64 at offset */
  readF64(offset: number): number {
    return this.view().getFloat64(offset, true);
  }

  /** Write f64 at offset */
  writeF64(offset: number, value: number): void {
    this.view().setFloat64(offset, value, true);
  }

  /** Read i32 at offset */
  readI32(offset: number): number {
    return this.view().getInt32(offset, true);
  }

  /** Write i32 at offset */
  writeI32(offset: number, value: number): void {
    this.view().setInt32(offset, value, true);
  }

  /** Read u8 at offset */
  readU8(offset: number): number {
    return this.view().getUint8(offset);
  }

  /** Write u8 at offset */
  writeU8(offset: number, value: number): void {
    this.view().setUint8(offset, value);
  }
}
