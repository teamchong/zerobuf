import { TYPE_BYTES, type ColumnDef, type Schema, type Allocation } from "./types.js";

/**
 * Compute columnar memory layout for a schema + row count.
 *
 * Layout: columns packed sequentially, each aligned to its element size.
 * Returns the total byte size and per-column offsets.
 */
export function computeLayout(
  schema: Schema,
  rows: number,
): { totalBytes: number; columnOffsets: Record<string, number> } {
  const columnOffsets: Record<string, number> = {};
  let offset = 0;

  for (const col of schema) {
    const elemBytes = TYPE_BYTES[col.type];
    // Align to element size
    const align = elemBytes;
    offset = alignUp(offset, align);
    columnOffsets[col.name] = offset;
    offset += elemBytes * rows;
  }

  return { totalBytes: offset, columnOffsets };
}

/** Align value up to the given alignment */
function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

/**
 * Allocate a columnar block in a WASM memory buffer.
 *
 * @param memory - The WASM Memory object
 * @param alloc - WASM allocator function: (bytes) => pointer
 * @param schema - Column definitions
 * @param rows - Number of rows to allocate
 */
export function allocateBlock(
  memory: WebAssembly.Memory,
  alloc: (bytes: number) => number,
  schema: Schema,
  rows: number,
): Allocation {
  const { totalBytes, columnOffsets } = computeLayout(schema, rows);
  const offset = alloc(totalBytes);

  // Adjust column offsets to be absolute (base + relative)
  const absoluteOffsets: Record<string, number> = {};
  for (const [name, relOffset] of Object.entries(columnOffsets)) {
    absoluteOffsets[name] = offset + relOffset;
  }

  return {
    offset,
    rows,
    columnOffsets: absoluteOffsets,
    totalBytes,
  };
}
