import { Arena } from "./arena.js";
import {
  Tag,
  VALUE_SLOT,
  STRING_HEADER,
  ARRAY_HEADER,
  OBJECT_ENTRY,
  OBJECT_HEADER,
} from "./types.js";
import { writeValue as writeVal } from "./encode.js";

const decoder = new TextDecoder();
const enc = new TextEncoder();

/** Read a tagged value at `offset`. Returns the JS value (lazy for objects/arrays). */
export function readValue(arena: Arena, offset: number): unknown {
  const tag = arena.readU8(offset) as Tag;

  switch (tag) {
    case Tag.Null:
      return null;
    case Tag.Bool:
      return arena.readU32(offset + 4) !== 0;
    case Tag.I32:
      return arena.readI32(offset + 4);
    case Tag.F64:
      return arena.readF64(offset + 8);
    case Tag.BigInt:
      return arena.readI64(offset + 8);
    case Tag.String:
      return readString(arena, arena.readU32(offset + 4));
    case Tag.Bytes:
      return readBytes(arena, arena.readU32(offset + 4));
    case Tag.Array:
      return createArrayProxy(arena, arena.readU32(offset + 4));
    case Tag.Object:
      return createObjectProxy(arena, arena.readU32(offset + 4));
    default:
      return null;
  }
}

/**
 * Eagerly read a tagged value into a plain JS object/array.
 * Recursively converts all nested structures — no Proxies in the result.
 * Use this when you need to read the same fields many times (hot loops).
 */
export function readValueEager(arena: Arena, offset: number): unknown {
  const tag = arena.readU8(offset) as Tag;

  switch (tag) {
    case Tag.Null:
      return null;
    case Tag.Bool:
      return arena.readU32(offset + 4) !== 0;
    case Tag.I32:
      return arena.readI32(offset + 4);
    case Tag.F64:
      return arena.readF64(offset + 8);
    case Tag.BigInt:
      return arena.readI64(offset + 8);
    case Tag.String:
      return readString(arena, arena.readU32(offset + 4));
    case Tag.Bytes:
      return readBytes(arena, arena.readU32(offset + 4));
    case Tag.Array:
      return toJSArray(arena, arena.readU32(offset + 4));
    case Tag.Object:
      return toJSObject(arena, arena.readU32(offset + 4));
    default:
      return null;
  }
}

/** Convert an array handle into a plain JS array (recursive). */
export function toJSArray(arena: Arena, handlePtr: number): unknown[] {
  const dataPtr = deref(arena, handlePtr);
  const length = arena.readU32(dataPtr + 4);
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    result.push(readValueEager(arena, dataPtr + ARRAY_HEADER + i * VALUE_SLOT));
  }
  return result;
}

/** Convert an object handle into a plain JS object (recursive). */
export function toJSObject(arena: Arena, handlePtr: number): Record<string, unknown> {
  const dataPtr = deref(arena, handlePtr);
  const count = arena.readU32(dataPtr + 4);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    const entryOffset = dataPtr + OBJECT_HEADER + i * OBJECT_ENTRY;
    const keyPtr = arena.readU32(entryOffset);
    const keyLen = arena.readU32(entryOffset + 4);
    const key = decoder.decode(new Uint8Array(arena.memory.buffer, keyPtr, keyLen));
    result[key] = readValueEager(arena, entryOffset + 8);
  }
  return result;
}

/** Read a string from its header pointer. */
export function readString(arena: Arena, ptr: number): string {
  const byteLen = arena.readU32(ptr);
  const bytes = new Uint8Array(arena.memory.buffer, ptr + STRING_HEADER, byteLen);
  return decoder.decode(bytes);
}

/** Read a byte buffer from its header pointer. Returns a copy (decoupled from WASM memory). */
export function readBytes(arena: Arena, ptr: number): Uint8Array {
  const byteLen = arena.readU32(ptr);
  return new Uint8Array(arena.memory.buffer, ptr + STRING_HEADER, byteLen).slice();
}

/**
 * Dereference a handle — read the data pointer stored at handlePtr.
 * All proxies go through this indirection so realloc can update the
 * data pointer without invalidating the proxy.
 */
function deref(arena: Arena, handlePtr: number): number {
  return arena.readU32(handlePtr);
}

// ---------- Array Proxy ----------

/**
 * Create a Proxy for an array in WASM memory.
 * Element reads are cached — repeated access to the same index avoids
 * re-decoding from WASM. Cache is invalidated per-element on write,
 * and cleared on push/pop.
 */
export function createArrayProxy(arena: Arena, handlePtr: number): unknown[] {
  const cache = new Map<number, unknown>();

  const handler: ProxyHandler<unknown[]> = {
    get(_target, prop) {
      if (prop === "__zerobuf_ptr") return handlePtr;
      if (prop === "__zerobuf_arena") return arena;

      const dataPtr = deref(arena, handlePtr);

      if (prop === "length") {
        return arena.readU32(dataPtr + 4);
      }

      if (prop === "push") {
        return (...items: unknown[]) => {
          for (const item of items) {
            arrayPush(arena, handlePtr, item);
          }
          // Push may realloc — clear cache (pointers to nested proxies still valid via handles)
          cache.clear();
          return arena.readU32(deref(arena, handlePtr) + 4);
        };
      }

      if (prop === "pop") {
        return () => {
          const dp = deref(arena, handlePtr);
          const len = arena.readU32(dp + 4);
          if (len > 0) cache.delete(len - 1);
          return arrayPop(arena, handlePtr);
        };
      }

      if (prop === "toJS") {
        return () => toJSArray(arena, handlePtr);
      }

      if (prop === Symbol.iterator) {
        return function* () {
          const dp = deref(arena, handlePtr);
          const len = arena.readU32(dp + 4);
          for (let i = 0; i < len; i++) {
            if (cache.has(i)) {
              yield cache.get(i);
            } else {
              const val = readValue(arena, dp + ARRAY_HEADER + i * VALUE_SLOT);
              cache.set(i, val);
              yield val;
            }
          }
        };
      }

      if (typeof prop === "string") {
        const index = Number(prop);
        if (Number.isInteger(index) && index >= 0) {
          const len = arena.readU32(dataPtr + 4);
          if (index >= len) return undefined;
          if (cache.has(index)) return cache.get(index);
          const val = readValue(arena, dataPtr + ARRAY_HEADER + index * VALUE_SLOT);
          cache.set(index, val);
          return val;
        }
      }

      return undefined;
    },

    set(_target, prop, value) {
      if (typeof prop === "string") {
        const index = Number(prop);
        if (Number.isInteger(index) && index >= 0) {
          const dataPtr = deref(arena, handlePtr);
          const len = arena.readU32(dataPtr + 4);
          if (index >= len) return false;
          writeVal(arena, dataPtr + ARRAY_HEADER + index * VALUE_SLOT, value);
          cache.delete(index);
          return true;
        }
      }
      return false;
    },

    has(_target, prop) {
      if (typeof prop === "string") {
        const index = Number(prop);
        if (Number.isInteger(index) && index >= 0) {
          return index < arena.readU32(deref(arena, handlePtr) + 4);
        }
      }
      return prop === "length" || prop === "push" || prop === "pop" || prop === "toJS"
        || prop === Symbol.iterator || prop === "__zerobuf_ptr" || prop === "__zerobuf_arena";
    },

    ownKeys() {
      const len = arena.readU32(deref(arena, handlePtr) + 4);
      const keys: string[] = [];
      for (let i = 0; i < len; i++) keys.push(String(i));
      keys.push("length");
      return keys;
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (prop === "length" || (typeof prop === "string" && Number.isInteger(Number(prop)))) {
        return { configurable: true, enumerable: true, writable: true };
      }
      return undefined;
    },

    deleteProperty() {
      return false;
    },
  };

  return new Proxy([] as unknown[], handler);
}

// ---------- Object Accessor ----------

/**
 * Define a get/set accessor on `target` for a known object entry.
 * The entry index is captured in the closure — no findEntry scan on read/write.
 */
function defineAccessor(
  target: Record<string, unknown>,
  arena: Arena,
  handlePtr: number,
  key: string,
  entryIndex: number,
): void {
  Object.defineProperty(target, key, {
    get() {
      const dp = deref(arena, handlePtr);
      return readValue(arena, dp + OBJECT_HEADER + entryIndex * OBJECT_ENTRY + 8);
    },
    set(v: unknown) {
      const dp = deref(arena, handlePtr);
      writeVal(arena, dp + OBJECT_HEADER + entryIndex * OBJECT_ENTRY + 8, v);
    },
    enumerable: true,
    configurable: true,
  });
}

/**
 * Create an accessor-backed object for WASM memory.
 *
 * Uses Object.defineProperty for all known keys — V8 can optimize these
 * with hidden classes and inline caching (unlike Proxy get traps).
 * A thin Proxy wrapper (no `get` trap) intercepts `set` for new key addition.
 */
export function createObjectProxy(arena: Arena, handlePtr: number): Record<string, unknown> {
  const target = Object.create(null) as Record<string, unknown>;

  // Non-enumerable internal properties
  Object.defineProperty(target, "__zerobuf_ptr", { value: handlePtr });
  Object.defineProperty(target, "__zerobuf_arena", { value: arena });
  Object.defineProperty(target, "toJS", {
    value: () => toJSObject(arena, handlePtr),
  });

  // Define accessors for all current keys (index captured — no linear scan)
  const dataPtr = deref(arena, handlePtr);
  const count = arena.readU32(dataPtr + 4);
  for (let i = 0; i < count; i++) {
    const entryOffset = dataPtr + OBJECT_HEADER + i * OBJECT_ENTRY;
    const keyPtr = arena.readU32(entryOffset);
    const keyLen = arena.readU32(entryOffset + 4);
    const key = decoder.decode(new Uint8Array(arena.memory.buffer, keyPtr, keyLen));
    defineAccessor(target, arena, handlePtr, key, i);
  }

  // Proxy only for new-key interception and delete prevention — no get trap
  return new Proxy(target, {
    set(target, prop, value) {
      if (typeof prop !== "string") return false;

      // Existing key — delegate to defineProperty setter (no findEntry)
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc?.set) {
        desc.set.call(target, value);
        return true;
      }

      // New key — write to WASM, then define accessor
      const dp = deref(arena, handlePtr);
      const idx = arena.readU32(dp + 4); // current count = new entry index
      objectAdd(arena, handlePtr, prop, value);
      defineAccessor(target, arena, handlePtr, prop, idx);
      return true;
    },

    deleteProperty() {
      return false;
    },
  });
}

// ---------- Internal: array growth ----------

function arrayPush(arena: Arena, handlePtr: number, value: unknown): void {
  let dataPtr = deref(arena, handlePtr);
  const capacity = arena.readU32(dataPtr);
  const length = arena.readU32(dataPtr + 4);

  if (length < capacity) {
    writeVal(arena, dataPtr + ARRAY_HEADER + length * VALUE_SLOT, value);
    arena.writeU32(dataPtr + 4, length + 1);
    return;
  }

  // Grow: allocate 2x, copy, update handle
  const newCapacity = capacity * 2;
  const newDataPtr = arena.alloc(ARRAY_HEADER + VALUE_SLOT * newCapacity, 4);
  arena.writeU32(newDataPtr, newCapacity);
  arena.writeU32(newDataPtr + 4, length + 1);

  // Copy existing elements
  const oldDataSize = length * VALUE_SLOT;
  new Uint8Array(arena.memory.buffer, newDataPtr + ARRAY_HEADER, oldDataSize).set(
    new Uint8Array(arena.memory.buffer, dataPtr + ARRAY_HEADER, oldDataSize),
  );

  // Write new element
  writeVal(arena, newDataPtr + ARRAY_HEADER + length * VALUE_SLOT, value);

  // Update handle to point to new data
  arena.writeU32(handlePtr, newDataPtr);
}

function arrayPop(arena: Arena, handlePtr: number): unknown {
  const dataPtr = deref(arena, handlePtr);
  const length = arena.readU32(dataPtr + 4);
  if (length === 0) return undefined;
  const val = readValue(arena, dataPtr + ARRAY_HEADER + (length - 1) * VALUE_SLOT);
  arena.writeU32(dataPtr + 4, length - 1);
  return val;
}

// ---------- Internal: object growth ----------

function objectAdd(arena: Arena, handlePtr: number, key: string, value: unknown): void {
  let dataPtr = deref(arena, handlePtr);
  const capacity = arena.readU32(dataPtr);
  const count = arena.readU32(dataPtr + 4);

  if (count < capacity) {
    appendEntry(arena, dataPtr, count, key, value);
    arena.writeU32(dataPtr + 4, count + 1);
    return;
  }

  // Grow: allocate 2x, copy, update handle
  const newCapacity = capacity * 2;
  const newDataPtr = arena.alloc(OBJECT_HEADER + OBJECT_ENTRY * newCapacity, 4);
  arena.writeU32(newDataPtr, newCapacity);
  arena.writeU32(newDataPtr + 4, count + 1);

  // Copy existing entries
  const oldSize = count * OBJECT_ENTRY;
  new Uint8Array(arena.memory.buffer, newDataPtr + OBJECT_HEADER, oldSize).set(
    new Uint8Array(arena.memory.buffer, dataPtr + OBJECT_HEADER, oldSize),
  );

  // Append new entry
  appendEntry(arena, newDataPtr, count, key, value);

  // Update handle
  arena.writeU32(handlePtr, newDataPtr);
}

function appendEntry(
  arena: Arena,
  dataPtr: number,
  index: number,
  key: string,
  value: unknown,
): void {
  const entryOffset = dataPtr + OBJECT_HEADER + index * OBJECT_ENTRY;
  const keyBytes = enc.encode(key);
  const keyPtr = arena.allocBytes(keyBytes);
  arena.writeU32(entryOffset, keyPtr);
  arena.writeU32(entryOffset + 4, keyBytes.byteLength);
  writeVal(arena, entryOffset + 8, value);
}
