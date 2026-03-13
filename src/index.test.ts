import { describe, it, expect } from "vitest";
import { computeLayout, createTableView, type Schema, type Allocation } from "./index.js";

// Helpers to simulate WASM memory
function createMemory(pages = 1): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: pages }); // 64KB per page
}

function simpleAlloc(memory: WebAssembly.Memory) {
  let ptr = 0;
  return (bytes: number) => {
    const p = ptr;
    ptr += bytes;
    return p;
  };
}

const SCHEMA = [
  { name: "id", type: "i32" },
  { name: "x", type: "f64" },
  { name: "y", type: "f64" },
  { name: "flags", type: "u8" },
] as const satisfies Schema;

describe("computeLayout", () => {
  it("computes correct byte sizes", () => {
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 100);
    // id: 4*100 = 400 bytes at offset 0
    // x: 8*100 = 800 bytes at offset 400 (aligned to 8 → 400)
    // y: 8*100 = 800 bytes at offset 1200
    // flags: 1*100 = 100 bytes at offset 2000
    expect(columnOffsets["id"]).toBe(0);
    expect(columnOffsets["x"]).toBe(400);
    expect(columnOffsets["y"]).toBe(1200);
    expect(columnOffsets["flags"]).toBe(2000);
    expect(totalBytes).toBe(2100);
  });

  it("aligns columns to element size", () => {
    const schema = [
      { name: "a", type: "u8" },
      { name: "b", type: "f64" },
    ] as const satisfies Schema;
    const { columnOffsets } = computeLayout(schema, 3);
    // a: 1*3 = 3 bytes at offset 0
    // b needs 8-byte alignment → offset 8
    expect(columnOffsets["a"]).toBe(0);
    expect(columnOffsets["b"]).toBe(8);
  });
});

describe("createTableView", () => {
  it("reads and writes via row proxy", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 10);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 10,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);

    // Write via row proxy
    const row0 = table.row(0);
    row0.id = 42;
    row0.x = 3.14;
    row0.y = 2.71;
    row0.flags = 1;

    // Read back via row proxy
    expect(table.row(0).id).toBe(42);
    expect(table.row(0).x).toBeCloseTo(3.14);
    expect(table.row(0).y).toBeCloseTo(2.71);
    expect(table.row(0).flags).toBe(1);
  });

  it("reads and writes via column view", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 5);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 5,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);
    const idCol = table.column("id");

    idCol.set(0, 100);
    idCol.set(4, 999);

    expect(idCol.get(0)).toBe(100);
    expect(idCol.get(4)).toBe(999);
    expect(idCol.length).toBe(5);
  });

  it("bulk writes a column", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 4);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 4,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);
    table.writeColumn("id", [10, 20, 30, 40]);

    expect(table.row(0).id).toBe(10);
    expect(table.row(1).id).toBe(20);
    expect(table.row(2).id).toBe(30);
    expect(table.row(3).id).toBe(40);
  });

  it("row proxy supports in operator and Object.keys", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 1);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 1,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);
    const row = table.row(0);

    expect("id" in row).toBe(true);
    expect("nonexistent" in row).toBe(false);
    expect(Object.keys(row)).toEqual(["id", "x", "y", "flags"]);
  });

  it("throws on out of bounds row index", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 5);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 5,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);
    expect(() => table.row(-1)).toThrow(RangeError);
    expect(() => table.row(5)).toThrow(RangeError);
  });

  it("throws on unknown column", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 1);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 1,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);
    expect(() => table.column("nope" as any)).toThrow("Unknown column");
  });

  it("zero-copy: writing via column view is visible via row proxy", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 3);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 3,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);

    // Write via column
    table.column("x").set(1, 99.5);

    // Read via row — same underlying memory
    expect(table.row(1).x).toBeCloseTo(99.5);

    // Write via row
    table.row(2).x = 77.7;

    // Read via column
    expect(table.column("x").get(2)).toBeCloseTo(77.7);
  });

  it("zero-copy: typed array view shares WASM memory buffer", () => {
    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(SCHEMA, 10);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 10,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, SCHEMA, allocation);
    const idArr = table.column("id").typedArray as Int32Array;

    // The typed array's buffer IS the WASM memory buffer
    expect(idArr.buffer).toBe(memory.buffer);
  });

  it("handles bigint columns (i64/u64)", () => {
    const schema = [
      { name: "ts", type: "i64" },
      { name: "count", type: "u64" },
    ] as const satisfies Schema;

    const memory = createMemory();
    const alloc = simpleAlloc(memory);
    const { totalBytes, columnOffsets } = computeLayout(schema, 3);
    const offset = alloc(totalBytes);
    const absoluteOffsets: Record<string, number> = {};
    for (const [name, rel] of Object.entries(columnOffsets)) {
      absoluteOffsets[name] = offset + rel;
    }
    const allocation: Allocation = {
      offset,
      rows: 3,
      columnOffsets: absoluteOffsets,
      totalBytes,
    };

    const table = createTableView(memory, schema, allocation);
    table.row(0).ts = 1710000000000n;
    table.row(0).count = 42n;

    expect(table.row(0).ts).toBe(1710000000000n);
    expect(table.row(0).count).toBe(42n);
  });
});
