/** JSON schema for a database identifier (BIGINT identity, always positive). */
export const id = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;

/** Positive quantity that fits PostgreSQL's INTEGER. */
export const quantity = { type: 'integer', minimum: 1, maximum: 2_147_483_647 } as const;

export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id },
} as const;
