/**
 * Value tags — stored in WASM memory so both JS and WASM know the type.
 *
 * Memory layout per tagged value (16 bytes, aligned):
 *   [tag: u8] [padding: 3 bytes] [ptr_or_inline: u32] [number: f64]
 *
 * Numbers: f64 stored in the last 8 bytes.
 * Integers: i32 stored in ptr_or_inline (4 bytes).
 * Booleans: 0 or 1 in ptr_or_inline.
 * Strings/Arrays/Objects: pointer in ptr_or_inline (byte offset in WASM memory).
 */
export const enum Tag {
  Null = 0,
  Bool = 1,
  I32 = 2,
  F64 = 3,
  String = 4,
  Array = 5,
  Object = 6,
  BigInt = 7,
  Bytes = 8,
}

/** Bytes per tagged value slot */
export const VALUE_SLOT = 16;

/**
 * String layout in WASM memory:
 *   [byteLen: u32] [utf8 bytes...]
 */
export const STRING_HEADER = 4;

/**
 * Array layout in WASM memory:
 *   [capacity: u32] [length: u32] [values: VALUE_SLOT * capacity]
 */
export const ARRAY_HEADER = 8;

/**
 * Object layout in WASM memory:
 *   [capacity: u32] [count: u32] [entries...]
 *
 * Each entry:
 *   [keyPtr: u32] [keyLen: u32] [value: VALUE_SLOT]
 *
 * keyPtr points to the raw utf8 bytes (no string header — length is in keyLen).
 */
export const OBJECT_HEADER = 8;
export const OBJECT_ENTRY = 8 + VALUE_SLOT; // keyPtr(4) + keyLen(4) + value(16) = 24
