const d = new Diagram();

const yourJstsCode = d.addBox("Your JS/TS Code", { row: 0, col: 1, color: "frontend", width: 200, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2 });
const zerobufcreateZerobufread = d.addBox("zerobuf.create()\nzerobuf.read()", { row: 1, col: 0, color: "backend", width: 200, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2 });
const defineschemaSchemacreate = d.addBox("defineSchema()\nschema.create()", { row: 1, col: 2, color: "backend", width: 200, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2 });
const arenaSaveRestoreAllocGrow = d.addBox("Arena\nsave() / restore()\nalloc() / grow()", { row: 2, col: 1, color: "orchestration", width: 260, height: 80, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2 });
const arraybufferOrSharedarraybuffer = d.addBox("ArrayBuffer\n(or SharedArrayBuffer)", { row: 3, col: 1, color: "storage", width: 260, height: 60, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2 });
const worker = d.addBox("Worker", { row: 4, col: 0, color: "frontend", width: 140, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2, icon: "server" });
const wasmZigRustC = d.addBox("WASM\n(Zig / Rust / C)", { row: 4, col: 1, color: "ai", width: 160, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2 });
const durableObject = d.addBox("Durable Object", { row: 4, col: 2, color: "backend", width: 160, strokeWidth: 1, roughness: 0, opacity: 90, fontFamily: 2, icon: "cloud" });

const zerobufApi = d.addGroup("zerobuf API", [zerobufcreateZerobufread, defineschemaSchemacreate], { padding: 20 });
const memory = d.addGroup("Memory", [arenaSaveRestoreAllocGrow, arraybufferOrSharedarraybuffer], { padding: 20 });
const consumers = d.addGroup("Consumers", [worker, wasmZigRustC, durableObject], { padding: 20 });

d.connect(yourJstsCode, zerobufcreateZerobufread, "dynamic");
d.connect(yourJstsCode, defineschemaSchemacreate, "fixed layout");
d.connect(zerobufcreateZerobufread, arenaSaveRestoreAllocGrow, "encode/decode");
d.connect(defineschemaSchemacreate, arenaSaveRestoreAllocGrow, "precomputed offsets");
d.connect(arenaSaveRestoreAllocGrow, arraybufferOrSharedarraybuffer, "reads/writes");
d.connect(arraybufferOrSharedarraybuffer, worker, "postMessage\n(zero-copy)");
d.connect(arraybufferOrSharedarraybuffer, wasmZigRustC, "memory.buffer\n(shared)");
d.connect(arraybufferOrSharedarraybuffer, durableObject, "storage.put\n(binary)");

return d.render({ path: "/Users/steven_chong/Downloads/repos/zerobuf/docs/src/content/docs/architecture" });