import { Arena, type ArenaOptions } from "./arena.js";
import { allocObject } from "./encode.js";
import { readValue, createObjectProxy, createArrayProxy } from "./decode.js";

export { Arena, type ArenaOptions } from "./arena.js";
export { Tag, VALUE_SLOT, STRING_HEADER, ARRAY_HEADER, OBJECT_HEADER, OBJECT_ENTRY } from "./types.js";
export { writeValue, allocString, allocBytes, allocArray, allocObject } from "./encode.js";
export { readValue, readValueEager, readString, readBytes, createObjectProxy, createArrayProxy, toJSObject, toJSArray } from "./decode.js";

export interface ZeroBuf {
  /** The arena allocator managing WASM memory */
  readonly arena: Arena;

  /**
   * Create a JS value in WASM memory. Returns an accessor object that
   * reads/writes directly from WASM linear memory — zero copy.
   *
   * Objects use defineProperty getters (V8-optimized). Arrays use a
   * cached Proxy. Nested structures are allocated recursively.
   */
  create<T extends Record<string, unknown>>(value: T): T & Record<string, unknown>;

  /**
   * Wrap an existing pointer in WASM memory as a Proxy.
   * The pointer must point to a handle (4 bytes holding a data pointer).
   * Use this to read results that WASM wrote directly.
   */
  wrapObject(handlePtr: number): Record<string, unknown>;

  /**
   * Wrap an existing array handle pointer as a Proxy.
   */
  wrapArray(handlePtr: number): unknown[];

  /**
   * Read a raw tagged value at a byte offset.
   */
  read(offset: number): unknown;

  /**
   * Save the current arena offset. Returns a checkpoint number.
   * Call restore() with this value to free all allocations made after the save.
   */
  save(): number;

  /**
   * Restore the arena to a previous checkpoint. All allocations made
   * after the checkpoint are abandoned. Accessor objects pointing to
   * freed memory will read garbage — do not use them after restore.
   */
  restore(checkpoint: number): void;
}

/**
 * Create a zerobuf instance over a WebAssembly.Memory.
 *
 * @param memory - The WASM Memory to use as backing store
 * @param startOffset - Byte offset to start allocating from (default 0).
 *   Set this past any WASM static data / stack to avoid clobbering.
 * @param options - Arena options (maxPages, etc.)
 */
export function zerobuf(memory: WebAssembly.Memory, startOffset = 0, options?: ArenaOptions): ZeroBuf {
  const arena = new Arena(memory, startOffset, options);

  return {
    get arena() {
      return arena;
    },

    create<T extends Record<string, unknown>>(value: T): T & Record<string, unknown> {
      const handlePtr = allocObject(arena, value as Record<string, unknown>);
      return createObjectProxy(arena, handlePtr) as T & Record<string, unknown>;
    },

    wrapObject(handlePtr: number): Record<string, unknown> {
      return createObjectProxy(arena, handlePtr);
    },

    wrapArray(handlePtr: number): unknown[] {
      return createArrayProxy(arena, handlePtr);
    },

    read(offset: number): unknown {
      return readValue(arena, offset);
    },

    save(): number {
      return arena.save();
    },

    restore(checkpoint: number): void {
      arena.restore(checkpoint);
    },
  };
}
