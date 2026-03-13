import { TYPE_ARRAY, TYPE_BYTES, type Schema, type Allocation, type RowType } from "./types.js";

/**
 * A ColumnView provides a zero-copy typed array view into WASM memory
 * for a single column.
 */
export interface ColumnView<T = number | bigint> {
  /** Number of rows */
  readonly length: number;
  /** Get value at row index */
  get(index: number): T;
  /** Set value at row index */
  set(index: number, value: T): void;
  /** Get the underlying typed array (zero-copy view into WASM memory) */
  readonly typedArray: ArrayBufferView;
}

/**
 * A TableView provides row-level and column-level access to a columnar
 * block in WASM memory. All access is zero-copy — reads and writes go
 * directly to/from wasm.memory.buffer.
 *
 * Row access uses Proxy for ergonomic `table.row(i).colName` syntax.
 * Column access returns typed array views for bulk operations.
 */
export interface TableView<S extends Schema> {
  /** Number of rows */
  readonly rows: number;
  /** Get a Proxy object for row i — reads/writes map to WASM memory */
  row(i: number): RowType<S>;
  /** Get a zero-copy column view */
  column<N extends S[number]["name"]>(name: N): ColumnView;
  /** Bulk write: copy a JS array into a column */
  writeColumn<N extends S[number]["name"]>(
    name: N,
    data: ArrayLike<number> | ArrayLike<bigint>,
  ): void;
  /** The underlying WASM memory allocation */
  readonly allocation: Allocation;
}

/**
 * Create a TableView over an allocated columnar block in WASM memory.
 *
 * The returned object provides:
 * - `table.row(i)` → Proxy that reads/writes WASM memory directly
 * - `table.column("name")` → typed array view (zero-copy)
 * - `table.writeColumn("name", data)` → bulk write
 */
export function createTableView<S extends Schema>(
  memory: WebAssembly.Memory,
  schema: S,
  allocation: Allocation,
): TableView<S> {
  // Build per-column typed array views
  const views = new Map<string, { typedArray: ArrayBufferView; elemBytes: number }>();

  for (const col of schema) {
    const ArrayCtor = TYPE_ARRAY[col.type];
    const byteOffset = allocation.columnOffsets[col.name];
    const view = new ArrayCtor(memory.buffer, byteOffset, allocation.rows);
    views.set(col.name, { typedArray: view, elemBytes: TYPE_BYTES[col.type] });
  }

  // Rebuild views if memory.buffer detaches (grows)
  function ensureViews(): void {
    // Check if any view's buffer is detached (memory grew)
    const first = views.values().next().value;
    if (first && (first.typedArray as any).buffer !== memory.buffer) {
      for (const col of schema) {
        const ArrayCtor = TYPE_ARRAY[col.type];
        const byteOffset = allocation.columnOffsets[col.name];
        const view = new ArrayCtor(memory.buffer, byteOffset, allocation.rows);
        views.set(col.name, { typedArray: view, elemBytes: TYPE_BYTES[col.type] });
      }
    }
  }

  function getTypedArray(name: string): any {
    ensureViews();
    const v = views.get(name);
    if (!v) throw new Error(`Unknown column: ${name}`);
    return v.typedArray;
  }

  const columnView = (name: string): ColumnView => {
    return {
      get length() {
        return allocation.rows;
      },
      get(index: number) {
        return getTypedArray(name)[index];
      },
      set(index: number, value: number | bigint) {
        getTypedArray(name)[index] = value;
      },
      get typedArray() {
        return getTypedArray(name);
      },
    };
  };

  // Row proxy handler — maps property access to column reads/writes
  const rowProxyHandler = (index: number): ProxyHandler<object> => ({
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const arr = getTypedArray(prop);
      if (!arr) return undefined;
      return arr[index];
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return false;
      const arr = getTypedArray(prop);
      if (!arr) return false;
      arr[index] = value;
      return true;
    },
    ownKeys() {
      return schema.map((c) => c.name);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && views.has(prop)) {
        return { configurable: true, enumerable: true, writable: true };
      }
      return undefined;
    },
    has(_target, prop) {
      return typeof prop === "string" && views.has(prop);
    },
  });

  return {
    get rows() {
      return allocation.rows;
    },

    row(i: number): RowType<S> {
      if (i < 0 || i >= allocation.rows) {
        throw new RangeError(`Row index ${i} out of bounds [0, ${allocation.rows})`);
      }
      return new Proxy({}, rowProxyHandler(i)) as RowType<S>;
    },

    column<N extends S[number]["name"]>(name: N): ColumnView {
      if (!views.has(name)) throw new Error(`Unknown column: ${name}`);
      return columnView(name);
    },

    writeColumn<N extends S[number]["name"]>(
      name: N,
      data: ArrayLike<number> | ArrayLike<bigint>,
    ): void {
      const arr = getTypedArray(name);
      const len = Math.min(data.length, allocation.rows);
      for (let i = 0; i < len; i++) {
        arr[i] = (data as any)[i];
      }
    },

    get allocation() {
      return allocation;
    },
  };
}
