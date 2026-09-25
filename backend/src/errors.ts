import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';

export interface ErrorBody {
  error: { code: string; message: string; sqlstate?: string };
}

interface Mapping {
  status: number;
  code: string;
}

/**
 * SQLSTATEs raised on purpose by the database functions, and PostgreSQL's own
 * input errors, mapped to HTTP. The database already produced a message meant
 * for the caller, so it is passed through.
 */
const SQLSTATE_MAPPINGS: Record<string, Mapping> = {
  P0002: { status: 404, code: 'NOT_FOUND' }, //          no_data_found
  '22023': { status: 400, code: 'INVALID_ARGUMENT' }, // invalid_parameter_value
  '22P02': { status: 400, code: 'INVALID_ARGUMENT' }, // invalid_text_representation
  '22003': { status: 400, code: 'INVALID_ARGUMENT' }, // numeric_value_out_of_range
  '22007': { status: 400, code: 'INVALID_ARGUMENT' }, // invalid_datetime_format
  '22008': { status: 400, code: 'INVALID_ARGUMENT' }, // datetime_field_overflow
  JD001: { status: 409, code: 'INSUFFICIENT_STOCK' },
  JD002: { status: 409, code: 'NOT_ACTIVE' },
};

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error.validation) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    } satisfies ErrorBody);
  }

  const mapping =
    error instanceof pg.DatabaseError && error.code ? SQLSTATE_MAPPINGS[error.code] : undefined;
  if (mapping) {
    return reply.status(mapping.status).send({
      error: { code: mapping.code, message: error.message, sqlstate: (error as pg.DatabaseError).code },
    } satisfies ErrorBody);
  }

  // Client errors raised by Fastify itself (e.g. malformed JSON body).
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      error: { code: 'BAD_REQUEST', message: error.message },
    } satisfies ErrorBody);
  }

  // Unexpected: log everything, reveal nothing about the internals.
  request.log.error(error);
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  } satisfies ErrorBody);
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send({
    error: { code: 'ROUTE_NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
  } satisfies ErrorBody);
}
