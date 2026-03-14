/**
 * Low-level slot readers/writers for raw DataView/Uint8Array access.
 *
 * Use these when working directly with WASM memory without an Arena —
 * e.g. writing request slots from a Worker, reading response slots
 * from a WASM module.
 */

import { Tag, VALUE_SLOT, STRING_HEADER } from "./types.js";

/** Write a string-tagged slot. Returns next aligned data offset. */
export function writeStringSlot(
  dv: DataView,
  u8: Uint8Array,
  slotOffset: number,
  dataOffset: number,
  bytes: Uint8Array,
): number {
  dv.setUint32(dataOffset, bytes.byteLength, true);
  u8.set(bytes, dataOffset + STRING_HEADER);
  dv.setUint8(slotOffset, Tag.String);
  dv.setUint32(slotOffset + 4, dataOffset, true);
  return (dataOffset + STRING_HEADER + bytes.byteLength + 3) & ~3;
}

/** Read a string from a string-tagged slot. Returns empty string if not a string tag. */
export function readStringSlot(
  dv: DataView,
  u8: Uint8Array,
  slotOffset: number,
): string {
  if (dv.getUint8(slotOffset) !== Tag.String) return "";
  const headerPtr = dv.getUint32(slotOffset + 4, true);
  if (headerPtr === 0) return "";
  const len = dv.getUint32(headerPtr, true);
  return new TextDecoder().decode(u8.subarray(headerPtr + STRING_HEADER, headerPtr + STRING_HEADER + len));
}

/** Write a bytes-tagged slot. Returns next aligned data offset. */
export function writeBytesSlot(
  dv: DataView,
  u8: Uint8Array,
  slotOffset: number,
  dataOffset: number,
  data: Uint8Array,
): number {
  dv.setUint32(dataOffset, data.byteLength, true);
  u8.set(data, dataOffset + STRING_HEADER);
  dv.setUint8(slotOffset, Tag.Bytes);
  dv.setUint32(slotOffset + 4, dataOffset, true);
  return (dataOffset + STRING_HEADER + data.byteLength + 3) & ~3;
}

/** Read bytes from a bytes-tagged slot. Returns empty array if not a bytes tag. */
export function readBytesSlot(
  dv: DataView,
  u8: Uint8Array,
  slotOffset: number,
): Uint8Array {
  if (dv.getUint8(slotOffset) !== Tag.Bytes) return new Uint8Array(0);
  const headerPtr = dv.getUint32(slotOffset + 4, true);
  if (headerPtr === 0) return new Uint8Array(0);
  const len = dv.getUint32(headerPtr, true);
  return u8.subarray(headerPtr + STRING_HEADER, headerPtr + STRING_HEADER + len);
}

/** Write an i32-tagged slot. */
export function writeI32Slot(dv: DataView, slotOffset: number, value: number): void {
  dv.setUint8(slotOffset, Tag.I32);
  dv.setInt32(slotOffset + 4, value, true);
}

/** Read an i32 from an i32-tagged slot. Returns 0 if not an i32 tag. */
export function readI32Slot(dv: DataView, slotOffset: number): number {
  if (dv.getUint8(slotOffset) !== Tag.I32) return 0;
  return dv.getInt32(slotOffset + 4, true);
}

/** Write an f64-tagged slot. */
export function writeF64Slot(dv: DataView, slotOffset: number, value: number): void {
  dv.setUint8(slotOffset, Tag.F64);
  dv.setFloat64(slotOffset + 8, value, true);
}

/** Read an f64 from an f64-tagged slot. Returns 0 if not an f64 tag. */
export function readF64Slot(dv: DataView, slotOffset: number): number {
  if (dv.getUint8(slotOffset) !== Tag.F64) return 0;
  return dv.getFloat64(slotOffset + 8, true);
}

/** Write a bool-tagged slot. */
export function writeBoolSlot(dv: DataView, slotOffset: number, value: boolean): void {
  dv.setUint8(slotOffset, Tag.Bool);
  dv.setUint32(slotOffset + 4, value ? 1 : 0, true);
}

/** Read a bool from a bool-tagged slot. Returns false if not a bool tag. */
export function readBoolSlot(dv: DataView, slotOffset: number): boolean {
  if (dv.getUint8(slotOffset) !== Tag.Bool) return false;
  return dv.getUint32(slotOffset + 4, true) !== 0;
}

/** Write a null-tagged slot. */
export function writeNullSlot(dv: DataView, slotOffset: number): void {
  dv.setUint8(slotOffset, Tag.Null);
}

/** Check if a slot is null-tagged. */
export function isNullSlot(dv: DataView, slotOffset: number): boolean {
  return dv.getUint8(slotOffset) === Tag.Null;
}

/** Read the tag byte from a slot. */
export function readTag(dv: DataView, slotOffset: number): number {
  return dv.getUint8(slotOffset);
}

export { Tag, VALUE_SLOT, STRING_HEADER } from "./types.js";
