// Minimal Zod-like validator for this project. Not full-featured Zod.
// Provides a tiny subset we need: z.string, z.number, z.boolean, z.literal, z.object, z.array, z.enum
export const z = (() => {
  const ok = (data) => ({ success: true, data });
  const err = (error) => ({ success: false, error });

  const makeBase = (check, typeName) => ({
    parse: (val) => {
      if (!check(val)) throw new Error(`Expected ${typeName}`);
      return val;
    },
    safeParse: (val) => (check(val) ? ok(val) : err({ message: `Expected ${typeName}`, received: val })),
  });

  const string = () => makeBase((v) => typeof v === 'string', 'string');
  const number = () => makeBase((v) => typeof v === 'number' && !Number.isNaN(v), 'number');
  const boolean = () => makeBase((v) => typeof v === 'boolean', 'boolean');
  const literal = (lit) => ({
    parse: (val) => {
      if (val !== lit) throw new Error(`Expected literal ${JSON.stringify(lit)}`);
      return val;
    },
    safeParse: (val) => (val === lit ? ok(val) : err({ message: `Expected literal ${JSON.stringify(lit)}`, received: val })),
  });
  const array = (schema) => ({
    parse: (val) => {
      if (!Array.isArray(val)) throw new Error('Expected array');
      return val.map((v) => schema.parse(v));
    },
    safeParse: (val) => {
      if (!Array.isArray(val)) return err({ message: 'Expected array', received: val });
      try {
        const data = val.map((v) => schema.parse(v));
        return ok(data);
      } catch (e) {
        return err({ message: e?.message || String(e) });
      }
    },
  });
  const object = (shape) => ({
    parse: (val) => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) throw new Error('Expected object');
      const out = {};
      for (const k of Object.keys(shape)) {
        out[k] = shape[k].parse(val[k]);
      }
      return out;
    },
    safeParse: (val) => {
      try { return ok(object(shape).parse(val)); } catch (e) { return err({ message: e?.message || String(e) }); }
    },
  });
  const enumeration = (values) => ({
    parse: (val) => {
      if (!values.includes(val)) throw new Error(`Expected one of ${values.join(', ')}`);
      return val;
    },
    safeParse: (val) => (values.includes(val) ? ok(val) : err({ message: `Expected one of ${values.join(', ')}` })),
  });

  return { string, number, boolean, literal, object, array, enum: enumeration };
})();
