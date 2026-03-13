/** Supported column data types mapped to TypedArray views */
export type ColumnType =
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "f32"
  | "f64";

/** Bytes per element for each column type */
export const TYPE_BYTES: Record<ColumnType, number> = {
  i8: 1,
  i16: 2,
  i32: 4,
  i64: 8,
  u8: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  f32: 4,
  f64: 8,
};

/** TypedArray constructor for each column type */
export const TYPE_ARRAY: Record<
  ColumnType,
  | typeof Int8Array
  | typeof Int16Array
  | typeof Int32Array
  | typeof BigInt64Array
  | typeof Uint8Array
  | typeof Uint16Array
  | typeof Uint32Array
  | typeof BigUint64Array
  | typeof Float32Array
  | typeof Float64Array
> = {
  i8: Int8Array,
  i16: Int16Array,
  i32: Int32Array,
  i64: BigInt64Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  u64: BigUint64Array,
  f32: Float32Array,
  f64: Float64Array,
};

/** Column definition: name + type */
export interface ColumnDef {
  name: string;
  type: ColumnType;
}

/** Schema = ordered list of column definitions */
export type Schema = readonly ColumnDef[];

/** Map schema to a TypeScript type where each column name → its element type */
export type RowType<S extends Schema> = {
  [K in S[number]["name"]]: Extract<S[number], { name: K }>["type"] extends
    | "i64"
    | "u64"
    ? bigint
    : number;
};

/** Allocation result from WASM */
export interface Allocation {
  /** Byte offset in WASM memory where the columnar block starts */
  offset: number;
  /** Number of rows allocated */
  rows: number;
  /** Per-column byte offsets (relative to allocation offset) */
  columnOffsets: Record<string, number>;
  /** Total bytes allocated */
  totalBytes: number;
}
