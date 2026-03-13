# colproxy

Zero-copy columnar access to WASM linear memory via TypeScript Proxy objects.

## What it does

Define a columnar schema. Allocate a block in `wasm.memory`. Get back Proxy objects that read/write directly from the WASM buffer — no copying, no serialization.

```typescript
import { computeLayout, createTableView } from "colproxy";

const schema = [
  { name: "id", type: "i32" },
  { name: "x", type: "f64" },
  { name: "y", type: "f64" },
] as const;

// Allocate in WASM memory
const { totalBytes, columnOffsets } = computeLayout(schema, 1000);
const ptr = wasmAlloc(totalBytes);

const table = createTableView(wasmMemory, schema, {
  offset: ptr,
  rows: 1000,
  columnOffsets: /* absolute offsets */,
  totalBytes,
});

// Row access — Proxy maps to WASM memory
table.row(0).id = 42;
table.row(0).x = 3.14;
console.log(table.row(0).id); // 42 — read from WASM memory

// Column access — zero-copy typed array view
const ids = table.column("id").typedArray; // Int32Array over wasm.memory.buffer
ids.buffer === wasmMemory.buffer; // true — same buffer, zero copy
```

## Why

WASM ↔ JS data exchange typically copies data across the boundary. When working with columnar data (query results, tensors, time series), this copy overhead adds up.

colproxy eliminates the copy by giving TypeScript direct access to WASM linear memory through typed array views and Proxy objects. The TypeScript side controls layout and allocation; the WASM side sees the same bytes.

## API

### `computeLayout(schema, rows)`

Compute byte sizes and per-column offsets for a columnar layout. Handles alignment.

### `allocateBlock(memory, alloc, schema, rows)`

Allocate a columnar block using a WASM allocator function.

### `createTableView(memory, schema, allocation)`

Create a `TableView` over allocated WASM memory:

- `table.row(i)` — Proxy object, reads/writes map to WASM memory
- `table.column(name)` — `ColumnView` with `.get()`, `.set()`, `.typedArray`
- `table.writeColumn(name, data)` — bulk write from JS array

### Column types

`i8`, `i16`, `i32`, `i64`, `u8`, `u16`, `u32`, `u64`, `f32`, `f64`

`i64`/`u64` use `BigInt64Array`/`BigUint64Array` (values are `bigint`).

## License

MIT
