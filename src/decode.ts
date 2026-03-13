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
    case Tag.String:
      return readString(arena, arena.readU32(offset + 4));
    case Tag.Array:
      return createArrayProxy(arena, arena.readU32(offset + 4));
    case Tag.Object:
      return createObjectProxy(arena, arena.readU32(offset + 4));
    default:
      return null;
  }
}

/** Read a string from its header pointer. */
export function readString(arena: Arena, ptr: number): string {
  const byteLen = arena.readU32(ptr);
  const bytes = new Uint8Array(arena.memory.buffer, ptr + STRING_HEADER, byteLen);
  return decoder.decode(bytes);
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

/** Create a Proxy for an array in WASM memory. */
export function createArrayProxy(arena: Arena, handlePtr: number): unknown[] {
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
          return arena.readU32(deref(arena, handlePtr) + 4);
        };
      }

      if (prop === "pop") {
        return () => arrayPop(arena, handlePtr);
      }

      if (prop === Symbol.iterator) {
        return function* () {
          const dp = deref(arena, handlePtr);
          const len = arena.readU32(dp + 4);
          for (let i = 0; i < len; i++) {
            yield readValue(arena, dp + ARRAY_HEADER + i * VALUE_SLOT);
          }
        };
      }

      if (typeof prop === "string") {
        const index = Number(prop);
        if (Number.isInteger(index) && index >= 0) {
          const len = arena.readU32(dataPtr + 4);
          if (index >= len) return undefined;
          return readValue(arena, dataPtr + ARRAY_HEADER + index * VALUE_SLOT);
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
      return prop === "length" || prop === "push" || prop === "pop";
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
  };

  return new Proxy([] as unknown[], handler);
}

// ---------- Object Proxy ----------

/** Create a Proxy for an object in WASM memory. */
export function createObjectProxy(arena: Arena, handlePtr: number): Record<string, unknown> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "__zerobuf_ptr") return handlePtr;
      if (prop === "__zerobuf_arena") return arena;
      if (typeof prop !== "string") return undefined;

      const dataPtr = deref(arena, handlePtr);
      const entry = findEntry(arena, dataPtr, prop);
      if (entry === -1) return undefined;
      return readValue(arena, entry + 8);
    },

    set(_target, prop, value) {
      if (typeof prop !== "string") return false;

      const dataPtr = deref(arena, handlePtr);
      const entry = findEntry(arena, dataPtr, prop);
      if (entry !== -1) {
        writeVal(arena, entry + 8, value);
        return true;
      }

      objectAdd(arena, handlePtr, prop, value);
      return true;
    },

    has(_target, prop) {
      if (typeof prop !== "string") return false;
      return findEntry(arena, deref(arena, handlePtr), prop) !== -1;
    },

    ownKeys() {
      return objectKeys(arena, deref(arena, handlePtr));
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && findEntry(arena, deref(arena, handlePtr), prop) !== -1) {
        return { configurable: true, enumerable: true, writable: true };
      }
      return undefined;
    },

    deleteProperty() {
      return false;
    },
  };

  return new Proxy({} as Record<string, unknown>, handler);
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

// ---------- Internal: object property lookup and growth ----------

function findEntry(arena: Arena, dataPtr: number, key: string): number {
  const count = arena.readU32(dataPtr + 4);
  const keyBytes = enc.encode(key);

  for (let i = 0; i < count; i++) {
    const entryOffset = dataPtr + OBJECT_HEADER + i * OBJECT_ENTRY;
    const keyPtr = arena.readU32(entryOffset);
    const keyLen = arena.readU32(entryOffset + 4);

    if (keyLen !== keyBytes.byteLength) continue;

    const stored = new Uint8Array(arena.memory.buffer, keyPtr, keyLen);
    let match = true;
    for (let j = 0; j < keyLen; j++) {
      if (stored[j] !== keyBytes[j]) {
        match = false;
        break;
      }
    }
    if (match) return entryOffset;
  }

  return -1;
}

function objectKeys(arena: Arena, dataPtr: number): string[] {
  const count = arena.readU32(dataPtr + 4);
  const keys: string[] = [];

  for (let i = 0; i < count; i++) {
    const entryOffset = dataPtr + OBJECT_HEADER + i * OBJECT_ENTRY;
    const keyPtr = arena.readU32(entryOffset);
    const keyLen = arena.readU32(entryOffset + 4);
    const bytes = new Uint8Array(arena.memory.buffer, keyPtr, keyLen);
    keys.push(decoder.decode(bytes));
  }

  return keys;
}

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
