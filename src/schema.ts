import { Arena } from "./arena.js";
import { VALUE_SLOT } from "./types.js";
import { writeValue } from "./encode.js";
import { readValue, readValueEager } from "./decode.js";

/**
 * Schema — fixed-layout objects with precomputed field offsets.
 *
 * Dynamic objects store key strings and use handle indirection.
 * Schema objects skip all of that: fields are at base + index * 16.
 * No Proxy, no handle, no key storage, no capacity/count headers.
 *
 * Trade-off: you can't add new fields after creation.
 */

/** A compiled schema that can create fixed-layout objects. */
export interface Schema<T extends Record<string, unknown>> {
  /** Byte size of one instance (fields.length * 16). */
  readonly size: number;
  /** Field names in order. */
  readonly fields: readonly string[];
  /** Allocate a new instance in the arena. Returns a defineProperty-backed object. */
  create(arena: Arena, values: T): T;
  /** Wrap an existing pointer as a schema object. */
  wrap(arena: Arena, ptr: number): T;
  /** Read all fields into a plain JS object. */
  toJS(arena: Arena, ptr: number): T;
}

/** Compile a schema from field names. */
export function defineSchema<T extends Record<string, unknown>>(
  fields: readonly (keyof T & string)[],
): Schema<T> {
  const offsets = new Map<string, number>();
  for (let i = 0; i < fields.length; i++) {
    offsets.set(fields[i], i * VALUE_SLOT);
  }
  const size = fields.length * VALUE_SLOT;

  return {
    size,
    fields,

    create(arena: Arena, values: T): T {
      const base = arena.alloc(size, 4);
      for (let i = 0; i < fields.length; i++) {
        writeValue(arena, base + i * VALUE_SLOT, values[fields[i]]);
      }
      return wrapSchema(arena, base, fields, offsets);
    },

    wrap(arena: Arena, ptr: number): T {
      return wrapSchema(arena, ptr, fields, offsets);
    },

    toJS(arena: Arena, ptr: number): T {
      const result = {} as Record<string, unknown>;
      for (let i = 0; i < fields.length; i++) {
        result[fields[i]] = readValueEager(arena, ptr + i * VALUE_SLOT);
      }
      return result as T;
    },
  };
}

function wrapSchema<T extends Record<string, unknown>>(
  arena: Arena,
  base: number,
  fields: readonly string[],
  offsets: Map<string, number>,
): T {
  const target = Object.create(null) as Record<string, unknown>;

  Object.defineProperty(target, "__zerobuf_ptr", { value: base });
  Object.defineProperty(target, "__zerobuf_arena", { value: arena });
  Object.defineProperty(target, "toJS", {
    value: () => {
      const result = {} as Record<string, unknown>;
      for (let i = 0; i < fields.length; i++) {
        result[fields[i]] = readValueEager(arena, base + i * VALUE_SLOT);
      }
      return result;
    },
  });

  for (let i = 0; i < fields.length; i++) {
    const fieldOffset = base + i * VALUE_SLOT;
    Object.defineProperty(target, fields[i], {
      get() {
        return readValue(arena, fieldOffset);
      },
      set(v: unknown) {
        writeValue(arena, fieldOffset, v);
      },
      enumerable: true,
      configurable: false,
    });
  }

  return target as T;
}
