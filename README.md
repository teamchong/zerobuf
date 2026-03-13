# zerobuf

Shared memory layout for JS and WASM. Both sides read/write the same `WebAssembly.Memory` — no serialization, no copies.

Used internally by [querymode](https://github.com/teamchong/querymode), [gitmode](https://github.com/teamchong/gitmode), [drawmode](https://github.com/teamchong/drawmode), and other *mode repos. Not published to npm yet.

## Usage

```typescript
import { zerobuf } from "zerobuf";

const memory = new WebAssembly.Memory({ initial: 1 });
const buf = zerobuf(memory);

// Allocate object in WASM linear memory
const obj = buf.create({ x: 1.0, y: 2.0, name: "alice" });

// Reads/writes go directly to WASM memory (defineProperty getters)
obj.x = 3.14;
console.log(obj.x); // 3.14 — read from WASM memory

// Pass pointer to WASM function
transform((obj as any).__zerobuf_ptr);

// WASM wrote result in-place — JS reads it back
console.log(obj.x);
```

## API

```typescript
const buf = zerobuf(memory, startOffset?, { maxPages? });

buf.create(value)        // allocate object in WASM memory, return accessor
buf.wrapObject(ptr)      // wrap existing WASM pointer as accessor
buf.wrapArray(ptr)       // wrap existing WASM array pointer
buf.read(offset)         // read raw tagged value at byte offset
buf.arena                // underlying Arena allocator

obj.toJS()               // convert to plain JS object (recursive)
arr.toJS()               // convert to plain JS array (recursive)
```

## Supported types

| Type | JS | WASM tag |
|---|---|---|
| null/undefined | `null` | 0 |
| boolean | `true`/`false` | 1 |
| integer | -2^31 to 2^31-1 | 2 (i32) |
| float | any number | 3 (f64) |
| string | UTF-8 | 4 |
| array | `unknown[]` | 5 |
| object | `Record<string, unknown>` | 6 |
| bigint | i64 range | 7 |
| bytes | `Uint8Array` | 8 |

Date stored as f64 epoch ms. NaN/Infinity supported. undefined stored as null.

## Performance

Object reads use `Object.defineProperty` getters with captured entry indices — V8 optimizes with hidden classes. Array reads are cached per-element.

Benchmarks (Node 22, Apple M-series):

| Operation | ops/sec |
|---|---|
| read f64 property | ~8M |
| write f64 property | ~7M |
| read string property | ~4M |
| read array element (cached) | ~7M |
| read array element (cold) | ~500K |
| toJS (plain JS copy) | ~27M reads/sec |

`.toJS()` returns a plain JS object for hot loops. 6x faster than accessor reads.

## Zig library

`zig/zerobuf.zig` reads/writes the same binary layout. 18 C ABI exports for cross-language FFI.

```zig
const zb = @import("zerobuf");

export fn transform(handle_ptr: u32) void {
    const mem = getMemorySlice();
    const obj = zb.ObjectReader.init(mem, handle_ptr);
    const x = obj.getF64("x") orelse return;
    // ...
}
```

Run Zig tests: `cd zig && zig build test`

## Memory

- Arena bump allocator, append-only (no free)
- Doubling growth strategy: O(log n) grows
- Max 65535 pages (~4GB). Configurable: `{ maxPages: 2048 }` for 128MB cap
- Handle indirection: arrays/objects survive realloc

## Status

- [x] JS library (dynamic objects, arrays, all types)
- [x] Zig library (read/write, C ABI exports)
- [x] Vitest tests (56 passing)
- [x] Benchmarks (CI posts to GITHUB_STEP_SUMMARY)
- [ ] Schema mode (fixed-offset access, no proxy overhead)
- [ ] Arena save/restore
- [ ] npm publish

## License

MIT
