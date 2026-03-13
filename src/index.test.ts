import { describe, it, expect } from "vitest";
import { zerobuf } from "./index.js";

function mem(pages = 1): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: pages });
}

describe("zerobuf", () => {
  describe("primitives", () => {
    it("reads and writes numbers", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ a: 42, b: 3.14 });
      expect(obj.a).toBe(42);
      expect(obj.b).toBeCloseTo(3.14);
    });

    it("reads and writes booleans", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ yes: true, no: false });
      expect(obj.yes).toBe(true);
      expect(obj.no).toBe(false);
    });

    it("reads and writes null", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ x: null });
      expect(obj.x).toBe(null);
    });

    it("reads and writes strings", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ name: "alice", greeting: "hello world" });
      expect(obj.name).toBe("alice");
      expect(obj.greeting).toBe("hello world");
    });

    it("handles large integers as i32", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ big: 2147483647, neg: -2147483648 });
      expect(obj.big).toBe(2147483647);
      expect(obj.neg).toBe(-2147483648);
    });

    it("handles floats as f64", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ pi: Math.PI, e: Math.E });
      expect(obj.pi).toBeCloseTo(Math.PI);
      expect(obj.e).toBeCloseTo(Math.E);
    });
  });

  describe("objects", () => {
    it("reads properties lazily from WASM memory", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ x: 1, y: 2, z: 3 });
      expect(obj.x).toBe(1);
      expect(obj.y).toBe(2);
      expect(obj.z).toBe(3);
    });

    it("writes properties directly to WASM memory", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ x: 1 });
      obj.x = 99;
      expect(obj.x).toBe(99);
    });

    it("overwrites string properties", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ name: "alice" });
      obj.name = "bob";
      expect(obj.name).toBe("bob");
    });

    it("adds new properties to existing objects", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ x: 1 });
      obj.y = 2;
      expect(obj.y).toBe(2);
      expect(obj.x).toBe(1);
    });

    it("supports Object.keys", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ a: 1, b: 2, c: 3 });
      expect(Object.keys(obj)).toEqual(["a", "b", "c"]);
    });

    it("supports in operator", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ x: 1 });
      expect("x" in obj).toBe(true);
      expect("y" in obj).toBe(false);
    });

    it("grows beyond initial capacity", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ a: 1 });
      // Initial capacity is 4, so adding 3 more fits
      obj.b = 2;
      obj.c = 3;
      obj.d = 4;
      // This exceeds capacity — triggers realloc
      obj.e = 5;
      obj.f = 6;

      expect(obj.a).toBe(1);
      expect(obj.b).toBe(2);
      expect(obj.c).toBe(3);
      expect(obj.d).toBe(4);
      expect(obj.e).toBe(5);
      expect(obj.f).toBe(6);
    });
  });

  describe("arrays", () => {
    it("reads elements by index", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [10, 20, 30] });
      const arr = obj.items as unknown[];
      expect(arr[0]).toBe(10);
      expect(arr[1]).toBe(20);
      expect(arr[2]).toBe(30);
      expect(arr.length).toBe(3);
    });

    it("writes elements by index", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [1, 2, 3] });
      const arr = obj.items as unknown[];
      arr[1] = 99;
      expect(arr[1]).toBe(99);
    });

    it("pushes new elements", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [1, 2] });
      const arr = obj.items as unknown[];
      arr.push(3);
      arr.push(4);
      expect(arr.length).toBe(4);
      expect(arr[2]).toBe(3);
      expect(arr[3]).toBe(4);
    });

    it("pops elements", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [1, 2, 3] });
      const arr = obj.items as unknown[];
      const val = arr.pop();
      expect(val).toBe(3);
      expect(arr.length).toBe(2);
    });

    it("grows beyond initial capacity", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [1] });
      const arr = obj.items as unknown[];
      // Initial capacity is 4, push beyond it
      arr.push(2);
      arr.push(3);
      arr.push(4);
      arr.push(5); // triggers realloc
      arr.push(6);

      expect(arr.length).toBe(6);
      expect(arr[0]).toBe(1);
      expect(arr[4]).toBe(5);
      expect(arr[5]).toBe(6);
    });

    it("supports iteration", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [10, 20, 30] });
      const arr = obj.items as unknown[];
      const collected: unknown[] = [];
      for (const item of arr) {
        collected.push(item);
      }
      expect(collected).toEqual([10, 20, 30]);
    });

    it("supports mixed types", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [1, "hello", true, null, 3.14] });
      const arr = obj.items as unknown[];
      expect(arr[0]).toBe(1);
      expect(arr[1]).toBe("hello");
      expect(arr[2]).toBe(true);
      expect(arr[3]).toBe(null);
      expect(arr[4]).toBeCloseTo(3.14);
    });
  });

  describe("nested structures", () => {
    it("reads nested objects", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({
        user: { name: "alice", age: 30 },
      });
      const user = obj.user as Record<string, unknown>;
      expect(user.name).toBe("alice");
      expect(user.age).toBe(30);
    });

    it("reads nested arrays of objects", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({
        users: [
          { name: "alice", score: 95 },
          { name: "bob", score: 87 },
        ],
      });
      const users = obj.users as Record<string, unknown>[];
      expect(users[0].name).toBe("alice");
      expect(users[0].score).toBe(95);
      expect(users[1].name).toBe("bob");
      expect(users[1].score).toBe(87);
    });

    it("writes to nested objects", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({
        config: { debug: false, level: 1 },
      });
      const config = obj.config as Record<string, unknown>;
      config.debug = true;
      config.level = 5;
      expect(config.debug).toBe(true);
      expect(config.level).toBe(5);
    });

    it("adds nested object as new property", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ name: "alice" });
      obj.address = { city: "NYC", zip: "10001" };
      const addr = obj.address as Record<string, unknown>;
      expect(addr.city).toBe("NYC");
      expect(addr.zip).toBe("10001");
    });

    it("pushes objects into arrays", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ items: [] as unknown[] });
      const arr = obj.items as unknown[];
      arr.push({ x: 1, y: 2 });
      arr.push({ x: 3, y: 4 });
      expect((arr[0] as any).x).toBe(1);
      expect((arr[1] as any).y).toBe(4);
    });

    it("deeply nested: 3 levels", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({
        a: { b: { c: { value: 42 } } },
      });
      const val = ((obj.a as any).b as any).c as any;
      expect(val.value).toBe(42);
    });
  });

  describe("lazy materialization", () => {
    it("does not read untouched properties", () => {
      const buf = zerobuf(mem());
      // Create a large object — only access one field
      const obj = buf.create({
        field1: "a".repeat(1000),
        field2: "b".repeat(1000),
        field3: "c".repeat(1000),
        target: 42,
      });

      // Only this field is read from WASM memory — the strings are never decoded
      expect(obj.target).toBe(42);
    });

    it("proxy has a stable pointer for WASM interop", () => {
      const buf = zerobuf(mem());
      const obj = buf.create({ x: 1 });
      const ptr = (obj as any).__zerobuf_ptr;
      expect(typeof ptr).toBe("number");
      expect(ptr).toBeGreaterThanOrEqual(0);
    });
  });

  describe("memory growth", () => {
    it("survives WASM memory growth", () => {
      const memory = mem(1); // 64KB
      const buf = zerobuf(memory);
      const obj = buf.create({ value: 123 });

      // Force memory growth
      memory.grow(1);

      // Proxy still reads correctly (DataView recreated on access)
      expect(obj.value).toBe(123);
    });
  });
});
