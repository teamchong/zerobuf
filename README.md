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
