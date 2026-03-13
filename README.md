# zerobuf

A shared memory layout for JS and WASM. Both sides read and write the same bytes — zero copy, zero serialization.

## The problem

Every WASM tool today copies data across the boundary:

```
JS → serialize → copy into WASM memory → WASM works → copy out → deserialize → JS
```

wasm-bindgen does this. AssemblyScript does this. Emscripten does this. Two full copies per call. For a 1MB buffer, that's 2MB of memcpy on every function call.

It gets worse with complex data. Pass an object with nested arrays? Serialize the whole tree in, deserialize the whole tree out. Even if WASM only touched one field.

## What zerobuf is

zerobuf is three things:

1. **A memory layout spec** — how numbers, strings, arrays, and objects are laid out in WASM linear memory. Both sides agree on the format.
2. **A JS library** — Proxy objects that read/write WASM memory directly. `obj.x` reads from `wasm.memory`, not from a JS copy.
3. **Language libraries** (planned) — Zig, Rust, C, Go, Python implementations that read/write the same layout. The WASM module imports zerobuf for its language and both sides share one source of truth.

Without the WASM-side library, zerobuf is just JS talking to itself. The value is that **both sides understand the same binary format**.

## How it works: end to end

### Step 1: Load a WASM module

Every WASM module has a `WebAssembly.Memory` — a resizable `ArrayBuffer` that both JS and WASM can access. This is where zerobuf lives.

```typescript
// Load your WASM module (Zig, Rust, C — any language)
const wasm = await WebAssembly.instantiate(wasmBytes, {
  env: { memory },  // shared memory
});

// Both JS and WASM see the same memory
const memory = wasm.instance.exports.memory as WebAssembly.Memory;
```

### Step 2: JS writes data into WASM memory

```typescript
import { zerobuf } from "zerobuf";

// Create a zerobuf instance over the shared memory
// startOffset = where WASM's static data ends (ask your WASM module)
const buf = zerobuf(memory, wasm.instance.exports.__heap_base.value);

// Create an object — allocated directly in WASM linear memory
const point = buf.create({ x: 1.0, y: 2.0, label: "origin" });

// point.x doesn't live in JS heap — it lives in wasm.memory
point.x = 3.14;  // writes to wasm.memory at a known byte offset
```

### Step 3: WASM reads the same memory

The WASM module reads `point`'s data directly — no copy, no deserialization. It knows the layout because it uses the zerobuf library for its language.

```typescript
// Pass the pointer to your WASM function
const transform = wasm.instance.exports.transform as (ptr: number) => void;
transform((point as any).__zerobuf_ptr);

// WASM wrote the result in-place — JS reads it back, still zero copy
console.log(point.x);  // reads WASM's output directly from memory
```

### Step 4: WASM writes, JS reads

WASM functions can allocate and write zerobuf objects too. JS wraps the pointer as a Proxy:

```typescript
// WASM function returns a pointer to a zerobuf object it created
const resultPtr = wasm.instance.exports.computeResult() as number;

// Wrap it — lazy, nothing is read until you access a field
const result = buf.wrapObject(resultPtr);
console.log(result.score);   // reads from WASM memory on access
console.log(result.label);   // string decoded from WASM memory on access
```

## Two modes

### Dynamic mode (current) — no schema, full flexibility

```typescript
const buf = zerobuf(memory);
const obj = buf.create({ x: 1, name: "alice", scores: [95, 87] });

obj.x = 99;                    // overwrite
obj.email = "alice@test.com";  // add new property
obj.scores.push(92);           // grow array
```

Objects and arrays can grow, properties can be added, types can be mixed. Uses Proxy + tagged values + linear key scan. ~100-200ns per access.

### Schema mode (planned) — fixed layout, maximum performance

```typescript
const Point = buf.schema({
  x: "f64",   // byte offset 0
  y: "f64",   // byte offset 8
  z: "f64",   // byte offset 16
});

const p = Point.create();
p.x = 3.14;  // direct write: memory[ptr + 0] = 3.14
p.x;         // direct read:  memory[ptr + 0] — ~1ns, no Proxy
```

Schema is defined once in TypeScript at module load time. Offsets are computed once. Accessors are closures over fixed offsets — no Proxy trap, no key lookup. Same speed as FlatBuffers but no build step, no compiler, no codegen.

**The same schema in Zig** (WASM side):

```zig
const Point = zerobuf.Schema(.{
    .x = .f64,  // offset 0
    .y = .f64,  // offset 8
    .z = .f64,  // offset 16
});

// Read what JS wrote — same offsets, same memory
pub fn transform(ptr: u32) void {
    var p = Point.at(memory, ptr);
    p.set_x(p.get_x() * 2.0);  // in-place, JS sees the result
}
```

Both sides define the same schema → both compute the same offsets → both read/write the same bytes. No serialization, no copy, no format negotiation.

## Multi-language support (planned)

zerobuf is a **binary layout spec** with native implementations per language. Each language gets its own package in its own ecosystem — no cross-language imports.

| Language | Package | Registry | Status |
|---|---|---|---|
| TypeScript/JS | `zerobuf` | npm | **Done** |
| Zig | `zerobuf.zig` | Zig package manager / single file | Planned |
| Rust | `zerobuf` | crates.io | Planned |
| C | `zerobuf.h` | Header-only (copy into project) | Planned |
| Go | `zerobuf-go` | Go module | Planned |
| Python | `zerobuf` | PyPI | Planned |

Each implementation reads/writes the same binary layout. A Zig WASM module and a TypeScript host share one `WebAssembly.Memory` with zero copies between them. They never import each other — they just agree on the byte format.

## Dynamic data

Objects grow. Arrays grow. Strings change length. zerobuf handles all of it in WASM memory.

```typescript
const user = buf.create({
  name: "alice",
  scores: [95, 87, 92],
  address: { city: "NYC", zip: "10001" },
});

// Array push — reallocs in WASM memory
user.scores.push(88);
user.scores.push(76);
console.log(user.scores.length);  // 5

// Add new property — extends object in WASM memory
user.email = "alice@example.com";

// Nested object — allocated in WASM memory
user.metadata = { joined: 2024, tier: "pro" };

// String reassignment — reallocs in WASM memory
user.name = "alice wonderland";
```

## Lazy materialization

Nothing is materialized until you touch it. A 10MB object tree in WASM memory costs zero JS heap until you read a specific field.

```typescript
// WASM produced a large result
const result = buf.wrapObject(resultPtr);

// No JS heap cost yet — result is just a Proxy
const name = result.items[0].name;  // reads 3 pointers + 1 string decode
// The other 9.99MB? Never touched. Never copied. Never materialized.
```

## Materialization: when you need speed over laziness

If you read `obj.x` in a hot loop 1000 times, that's 1000 Proxy traps. Call `.materialize()` to snapshot into a plain JS object:

```typescript
const obj = buf.create({ x: 3.14, y: 2.71, items: [1, 2, 3] });

// Hot loop — materialize first, then iterate
const snap = obj.materialize();  // plain JS object, no Proxy
for (let i = 0; i < 10_000; i++) {
  process(snap.x, snap.y);      // normal JS property access, full speed
}
```

`materialize()` recursively converts the entire structure. The result is decoupled from WASM memory.

| Pattern | Use |
|---|---|
| Read a few fields once | Lazy (default) |
| Hot inner loop | `.materialize()` first |
| Pass data to non-WASM code | `.materialize()` — returns plain JS |

## Arena memory management

### Save / restore (planned)

Stack-based allocation — allocate together, free together:

```typescript
const mark = buf.arena.save();    // save current position

const tmp = buf.create({ ... }); // allocate temp data
process(tmp);

buf.arena.restore(mark);          // free everything after mark — O(1)
```

| Pattern | How |
|---|---|
| Full reset | `arena.restore(0)` |
| Partial reset | `arena.save()` → work → `arena.restore(mark)` |
| Per-request | Save at request start, restore at request end |

### Growth strategy

Doubling strategy — O(log n) grows instead of O(n):

```
Alloc 1KB   → memory stays at 64KB  (fits)
Alloc 70KB  → memory grows to 128KB (doubled)
Alloc 200KB → memory grows to 256KB (doubled)
```

**4GB limit**: WASM linear memory maxes at 65535 pages (4GB minus 64KB — avoids Chrome unsigned overflow bug). zerobuf throws `RangeError` with a clear message.

**Configurable cap**: `zerobuf(memory, 0, { maxPages: 2048 })` limits to 128MB.

## Why this is safe: no race conditions

JS and WASM on the same thread **never run concurrently**:

```
JS calls WASM → WASM runs to completion → returns to JS
WASM calls JS → JS runs to completion → returns to WASM
```

```
JS:    ████░░░░████░░░░████
WASM:  ░░░░████░░░░████░░░░
       ↑ never overlapping on the same thread
```

No locks, no atomics, no synchronization needed.

| Scenario | Concurrent? | Race condition? |
|---|---|---|
| Same thread (main or Web Worker) | No — call/return | Impossible |
| WASM in separate Worker + `SharedArrayBuffer` | Yes | Yes — needs Atomics |
| Cloudflare Workers | No — `SharedArrayBuffer` disabled (Spectre) | Impossible |

## Comparison

| | wasm-bindgen | FlatBuffers | Emscripten | zerobuf |
|---|---|---|---|---|
| JS → WASM | serialize + copy | schema compile + write | serialize + copy | direct write to memory |
| WASM → JS | copy + deserialize | zero-copy read | copy + deserialize | zero-copy read |
| Partial read | copy entire result | read one field (~1ns) | copy entire result | read one field (~100ns dynamic, ~1ns schema) |
| Dynamic objects | no | no (immutable) | no | yes — push, extend, grow |
| Build step | codegen (proc macro) | schema compiler (flatc) | codegen (embind) | none |
| Multi-language | Rust only | 15+ languages | C/C++ only | JS (done), Zig/Rust/C/Go/Python (planned) |
| Cost of 10MB, read 1 field | copy 10MB | read ~8 bytes | copy 10MB | read ~16 bytes |

## License

MIT
