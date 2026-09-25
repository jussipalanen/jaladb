import pg from 'pg';

// BIGINT (int8) values such as ids and counts arrive as strings by default,
// because JavaScript numbers cannot represent every 64-bit integer. Convert
// them to numbers, but fail loudly instead of silently losing precision.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`BIGINT value ${value} is too large for a JavaScript number`);
  }
  return number;
});

/** Anything that can run a parameterised query: a pool or a single client. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}
