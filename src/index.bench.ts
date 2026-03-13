import { bench, describe } from "vitest";
import { zerobuf } from "./index.js";

function mem(pages = 1): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: pages });
}

describe("create", () => {
  const buf = zerobuf(mem(4));

  bench("small object { x, y, z }", () => {
    buf.create({ x: 1.0, y: 2.0, z: 3.0 });
  });

  bench("object with string", () => {
    buf.create({ name: "alice", score: 95 });
  });

  bench("object with nested object", () => {
    buf.create({ user: { name: "alice", age: 30 } });
  });

  bench("object with array", () => {
    buf.create({ items: [1, 2, 3, 4, 5] });
  });

  bench("complex nested structure", () => {
    buf.create({
      user: { name: "alice", age: 30 },
      scores: [95, 87, 92],
      active: true,
    });
  });
});

describe("read", () => {
  const buf = zerobuf(mem(4));
  const obj = buf.create({ x: 3.14, y: 2.71, name: "test" });

  bench("read f64 property", () => {
    void obj.x;
  });

  bench("read string property", () => {
    void obj.name;
  });
});

describe("write", () => {
  const buf = zerobuf(mem(4));
  const obj = buf.create({ x: 0, y: 0 });

  bench("write f64 property", () => {
    obj.x = 3.14;
  });

  bench("write string property", () => {
    obj.name = "alice";
  });
});

describe("array", () => {
  const buf = zerobuf(mem(4));

  bench("create array [100 elements]", () => {
    buf.create({ items: Array.from({ length: 100 }, (_, i) => i) });
  });

  bench("read array element (cold)", () => {
    const obj = buf.create({ items: [1, 2, 3, 4, 5] });
    const arr = obj.items as unknown[];
    void arr[2];
  });

  const cached = zerobuf(mem(4)).create({ items: [1, 2, 3, 4, 5] });
  const cachedArr = cached.items as unknown[];
  // Prime the cache
  void cachedArr[2];

  bench("read array element (cached)", () => {
    void cachedArr[2];
  });

  bench("push 10 elements", () => {
    const obj = buf.create({ items: [1] });
    const arr = obj.items as unknown[];
    for (let i = 0; i < 10; i++) arr.push(i);
  });
});

describe("toJS", () => {
  const buf = zerobuf(mem(4));

  bench("materialize small object", () => {
    const obj = buf.create({ x: 1, y: 2, name: "test" });
    (obj as any).toJS();
  });

  bench("materialize nested structure", () => {
    const obj = buf.create({
      user: { name: "alice", scores: [95, 87, 92] },
      tags: ["admin", "active"],
    });
    (obj as any).toJS();
  });

  const hot = buf.create({ x: 3.14, y: 2.71 });
  const snap = (hot as any).toJS();

  bench("hot loop: proxy read (baseline)", () => {
    void hot.x;
    void hot.y;
  });

  bench("hot loop: materialized read", () => {
    void snap.x;
    void snap.y;
  });
});
