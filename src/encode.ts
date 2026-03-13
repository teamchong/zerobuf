import { Arena } from "./arena.js";
import {
  Tag,
  VALUE_SLOT,
  STRING_HEADER,
  ARRAY_HEADER,
  OBJECT_HEADER,
  OBJECT_ENTRY,
} from "./types.js";

const encoder = new TextEncoder();

/**
 * Write a tagged value at `offset` in the arena.
 *
 * For arrays and objects, the value slot stores a **handle pointer** —
 * a stable 4-byte cell that holds the current data pointer. This lets
 * Proxy objects survive reallocation (data moves, handle stays).
 */
export function writeValue(arena: Arena, offset: number, value: unknown): void {
  if (value === null || value === undefined) {
    arena.writeU8(offset, Tag.Null);
    return;
  }

  if (typeof value === "boolean") {
    arena.writeU8(offset, Tag.Bool);
    arena.writeU32(offset + 4, value ? 1 : 0);
    return;
  }

  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
      arena.writeU8(offset, Tag.I32);
      arena.writeI32(offset + 4, value);
    } else {
      arena.writeU8(offset, Tag.F64);
      arena.writeF64(offset + 8, value);
    }
    return;
  }

  if (typeof value === "bigint") {
    arena.writeU8(offset, Tag.BigInt);
    arena.writeI64(offset + 8, value);
    return;
  }

  if (typeof value === "string") {
    const ptr = allocString(arena, value);
    arena.writeU8(offset, Tag.String);
    arena.writeU32(offset + 4, ptr);
    return;
  }

  if (value instanceof Date) {
    arena.writeU8(offset, Tag.F64);
    arena.writeF64(offset + 8, value.getTime());
    return;
  }

  if (value instanceof Uint8Array) {
    const ptr = allocBytes(arena, value);
    arena.writeU8(offset, Tag.Bytes);
    arena.writeU32(offset + 4, ptr);
    return;
  }

  // Check if value is already a zerobuf proxy (has a handle)
  const existingPtr = (value as any).__zerobuf_ptr;
  if (existingPtr !== undefined) {
    const tag = Array.isArray(value) ? Tag.Array : Tag.Object;
    arena.writeU8(offset, tag);
    arena.writeU32(offset + 4, existingPtr);
    return;
  }

  if (Array.isArray(value)) {
    const handlePtr = allocArray(arena, value);
    arena.writeU8(offset, Tag.Array);
    arena.writeU32(offset + 4, handlePtr);
    return;
  }

  if (typeof value === "object") {
    const handlePtr = allocObject(arena, value as Record<string, unknown>);
    arena.writeU8(offset, Tag.Object);
    arena.writeU32(offset + 4, handlePtr);
    return;
  }
}

/** Allocate a byte buffer in the arena. Returns pointer to header. Layout: [byteLength: u32] [bytes...] */
export function allocBytes(arena: Arena, data: Uint8Array): number {
  const ptr = arena.alloc(STRING_HEADER + data.byteLength, 4);
  arena.writeU32(ptr, data.byteLength);
  new Uint8Array(arena.memory.buffer, ptr + STRING_HEADER, data.byteLength).set(data);
  return ptr;
}

/** Allocate a string in the arena. Returns pointer to string header. */
export function allocString(arena: Arena, str: string): number {
  const bytes = encoder.encode(str);
  const ptr = arena.alloc(STRING_HEADER + bytes.byteLength, 4);
  arena.writeU32(ptr, bytes.byteLength);
  new Uint8Array(arena.memory.buffer, ptr + STRING_HEADER, bytes.byteLength).set(bytes);
  return ptr;
}

/**
 * Allocate an array in the arena. Returns a **handle pointer**.
 *
 * Layout:
 *   handle (4 bytes): [dataPtr: u32]  ← stable address, proxy captures this
 *   data (variable):  [capacity: u32] [length: u32] [values: VALUE_SLOT * capacity]
 */
export function allocArray(arena: Arena, items: unknown[]): number {
  const capacity = Math.max(items.length, 4);
  const dataPtr = arena.alloc(ARRAY_HEADER + VALUE_SLOT * capacity, 4);
  arena.writeU32(dataPtr, capacity);
  arena.writeU32(dataPtr + 4, items.length);

  for (let i = 0; i < items.length; i++) {
    writeValue(arena, dataPtr + ARRAY_HEADER + i * VALUE_SLOT, items[i]);
  }

  // Allocate stable handle that points to data
  const handlePtr = arena.alloc(4, 4);
  arena.writeU32(handlePtr, dataPtr);
  return handlePtr;
}

/**
 * Allocate an object in the arena. Returns a **handle pointer**.
 *
 * Layout:
 *   handle (4 bytes): [dataPtr: u32]  ← stable address, proxy captures this
 *   data (variable):  [capacity: u32] [count: u32] [entries: OBJECT_ENTRY * capacity]
 */
export function allocObject(arena: Arena, obj: Record<string, unknown>): number {
  const keys = Object.keys(obj);
  const capacity = Math.max(keys.length, 4);
  const dataPtr = arena.alloc(OBJECT_HEADER + OBJECT_ENTRY * capacity, 4);
  arena.writeU32(dataPtr, capacity);
  arena.writeU32(dataPtr + 4, keys.length);

  for (let i = 0; i < keys.length; i++) {
    const entryOffset = dataPtr + OBJECT_HEADER + i * OBJECT_ENTRY;
    const keyBytes = encoder.encode(keys[i]);
    const keyPtr = arena.allocBytes(keyBytes);
    arena.writeU32(entryOffset, keyPtr);
    arena.writeU32(entryOffset + 4, keyBytes.byteLength);
    writeValue(arena, entryOffset + 8, obj[keys[i]]);
  }

  // Allocate stable handle that points to data
  const handlePtr = arena.alloc(4, 4);
  arena.writeU32(handlePtr, dataPtr);
  return handlePtr;
}
