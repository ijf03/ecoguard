import type { ServerResponse } from 'node:http';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

export function sendError(response: ServerResponse, error: unknown) {
  const known = error instanceof ApiError;
  json(response, known ? error.status : 500, {
    error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'An unexpected error occurred.' },
  });
}
