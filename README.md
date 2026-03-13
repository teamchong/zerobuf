# zerobuf

Zero-copy JS ↔ WASM. No serialization. No `copyInto`. No `copyOut`. The JS object **is** the WASM memory.

## The problem

Every WASM tool today copies data across the boundary:

```
JS → serialize → copy into WASM memory → WASM works → copy out → deserialize → JS
```

wasm-bindgen does this. AssemblyScript does this. Emscripten does this. Two full copies per call. For a 1MB buffer, that's 2MB of memcpy on every function call.

It gets worse with complex data. Pass an object with nested arrays? Serialize the whole tree in, deserialize the whole tree out. Even if WASM only touched one field.

## How zerobuf works

zerobuf gives you a JS Proxy that **is** the WASM memory. No copy in, no copy out, ever.

```typescript
import { zerobuf } from "zerobuf";

const buf = zerobuf(wasmMemory);

// Create an object — allocated directly in WASM linear memory
const point = buf.create({ x: 1.0, y: 2.0, label: "origin" });

// Read — lazy, reads from WASM memory at access time
console.log(point.x);       // 1.0 — read from wasm.memory, not a JS copy
console.log(point.label);   // "origin" — decoded from WASM memory on access

// Write — immediate, writes to WASM memory
point.x = 3.14;             // WASM sees this instantly, no copy

// WASM function operates on the same memory
wasmTransform(point.ptr);   // WASM reads x=3.14 directly, writes result in-place
console.log(point.x);       // result — JS reads WASM's output, no copy back
```

Nothing is ever copied. The Proxy reads from WASM memory when you access a property. Writes to WASM memory when you set one. WASM reads and writes the same bytes. Both sides share one source of truth.

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

// WASM sees all of it at known offsets
wasmProcess(user.ptr);
```

## Lazy materialization

Nothing is materialized until you touch it. A 10MB object tree in WASM memory costs zero JS heap until you read a specific field. Read one field, pay for one field.

```typescript
// 10MB of data lives in WASM memory
const result = buf.wrap(wasmResultPtr);

// No JS heap cost yet — result is just a Proxy
// Only when you access a field does it read from WASM memory:
const name = result.items[0].name;  // reads 3 pointers + 1 string decode
// The other 9.99MB? Never touched. Never copied. Never materialized.
```

This matters for query engines, ML inference, game state — anywhere WASM produces large results and JS only needs part of them.

## Materialization: when you need speed over laziness

Lazy reads are great when you touch each field once. But if you read `obj.x` in a hot loop 1000 times, that's 1000 Proxy traps → 1000 DataView reads. Call `.materialize()` to snapshot into a plain JS object first:

```typescript
const obj = buf.create({ x: 3.14, y: 2.71, items: [1, 2, 3] });

// Hot loop — materialize first, then iterate
const snap = obj.materialize();  // plain JS object, no Proxy
for (let i = 0; i < 10_000; i++) {
  process(snap.x, snap.y);      // normal JS property access, full speed
}

// After WASM mutates the data, re-materialize for a fresh snapshot
wasmTransform(obj.ptr);
const snap2 = obj.materialize();
```

`materialize()` recursively converts the entire structure — nested objects become plain objects, arrays become plain arrays. The result is decoupled from WASM memory: mutating the Proxy won't affect the snapshot, and vice versa.

Works on both objects and arrays:

```typescript
const arr = obj.items;
const plainArr = arr.materialize();  // [1, 2, 3] — plain JS array
```

**When to use which:**

| Pattern | Use |
|---|---|
| Read a few fields once | Lazy (default) — no materialization cost |
| Read many fields in a loop | `.materialize()` first — pay once, read fast |
| Pass data to non-WASM code | `.materialize()` — returns plain JS, no Proxy |
| WASM writes, JS reads result | Lazy — read only what you need |
| Hot inner loop | `.materialize()` — eliminate Proxy overhead |

## Why this is safe: no race conditions

JS and WASM on the same thread **never run concurrently**. The call stack is strictly sequential:

```
JS calls WASM → WASM runs to completion → returns to JS
WASM calls JS → JS runs to completion → returns to WASM
```

No preemption, no interleaving. When JS reads or writes via a zerobuf Proxy, WASM is not running. When WASM reads or writes the same memory, JS is not running. One source of truth, one writer at a time, by design.

```
JS:    ████░░░░████░░░░████
WASM:  ░░░░████░░░░████░░░░
       ↑ never overlapping on the same thread
```

This is why zero-copy sharing works without locks, atomics, or synchronization. The single-threaded event loop guarantees it.

| Scenario | Concurrent? | Race condition? |
|---|---|---|
| Same thread (main or Web Worker) | No — call/return | Impossible |
| WASM in separate Worker + `SharedArrayBuffer` | Yes | Yes — needs Atomics |
| Cloudflare Workers | No — `SharedArrayBuffer` disabled (Spectre) | Impossible |

zerobuf targets the first and third scenarios. If you need multi-threaded shared WASM memory, you need Atomics — that's a different problem.

## Memory growth

WASM linear memory starts small and grows on demand. Each `memory.grow()` is expensive — it detaches the `ArrayBuffer`, invalidating all TypedArray views. zerobuf handles this correctly:

**Doubling strategy**: When a grow is needed, zerobuf doubles the current memory size (or allocates the exact amount needed, whichever is larger). This means O(log n) grows total instead of O(n) for incremental grows.

```
Alloc 1KB   → memory stays at 64KB  (fits)
Alloc 60KB  → memory stays at 64KB  (fits)
Alloc 70KB  → memory grows to 128KB (doubled from 64KB)
Alloc 200KB → memory grows to 256KB (doubled from 128KB)
...
```

**4GB hard limit**: WASM linear memory maxes out at 65536 pages = 4GB. When you hit it, zerobuf throws a `RangeError` with a clear message — not silent corruption.

**Configurable cap**: Set `maxPages` to limit memory usage below 4GB:

```typescript
// Limit to 128MB (2048 pages × 64KB)
const buf = zerobuf(wasmMemory, 0, { maxPages: 2048 });

// Throws RangeError when exceeded
buf.create({ data: hugePayload }); // "zerobuf: out of memory..."
```

**View caching**: DataView is cached and only recreated when the buffer detaches (after a grow). No allocation overhead on every read/write.

**What happens at 4GB**: You get a `RangeError`. The arena tracks remaining capacity via `arena.remaining`. Plan accordingly — if you're approaching the limit, `.materialize()` what you need and release the zerobuf instance.

## Comparison

| | wasm-bindgen | AssemblyScript | Emscripten | zerobuf |
|---|---|---|---|---|
| JS → WASM | serialize + copy | serialize + copy | serialize + copy | direct write to memory |
| WASM → JS | copy + deserialize | copy + deserialize | copy + deserialize | direct read from memory |
| Partial read | copy entire result, read one field | copy entire result | copy entire result | read one field, touch nothing else |
| Array push | not possible in WASM memory | copy out, push, copy back | copy out, push, copy back | realloc in WASM memory |
| Object extend | not possible | not possible | not possible | extend in WASM memory |
| Nested objects | flatten or serialize | GC objects (not in linear memory) | heap objects (opaque) | pointer-linked in linear memory |
| Cost of 10MB result, read 1 field | copy 10MB | copy 10MB | copy 10MB | read ~16 bytes |

## License

MIT
