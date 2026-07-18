import { describe, it, expect } from 'vitest';
import {
  ApiError,
  NotFoundError,
  AlreadyExistsError,
  InvalidStateError,
  ConcurrencyError,
  UniqueFieldError,
  isApiError,
} from './api-error.js';

describe('ApiError', () => {
  it('exposes code, message, and statusCode', () => {
    const e = new ApiError('foo', 'bar', 418);
    expect(e.code).toBe('foo');
    expect(e.message).toBe('bar');
    expect(e.statusCode).toBe(418);
    expect(e.name).toBe('ApiError');
  });

  it('defaults statusCode to 400', () => {
    expect(new ApiError('x', 'y').statusCode).toBe(400);
  });
});

describe('NotFoundError', () => {
  it('formats the message and sets 404', () => {
    const e = new NotFoundError('client', 'GRA-A26');
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('not_found');
    expect(e.message).toContain('client');
    expect(e.message).toContain('GRA-A26');
  });
});

describe('AlreadyExistsError', () => {
  it('sets 409 and exists code', () => {
    const e = new AlreadyExistsError('client', 'GRA-A26');
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe('already_exists');
  });
});

describe('InvalidStateError', () => {
  it('sets 409', () => {
    const e = new InvalidStateError('cannot rename removed client');
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe('invalid_state');
  });
});

describe('ConcurrencyError', () => {
  it('sets 503', () => {
    const e = new ConcurrencyError('too many retries');
    expect(e.statusCode).toBe(503);
    expect(e.code).toBe('concurrency_conflict');
  });
});

describe('UniqueFieldError', () => {
  it('sets 409, a unique code, and carries the field name', () => {
    const e = new UniqueFieldError('page', 'slug');
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe('unique_violation');
    expect(e.field).toBe('slug');
    expect(e.message).toContain('page');
    expect(e.message).toContain('slug');
    expect(isApiError(e)).toBe(true);
  });
});

describe('isApiError', () => {
  it('identifies ApiError and subclasses', () => {
    expect(isApiError(new ApiError('a', 'b'))).toBe(true);
    expect(isApiError(new NotFoundError('c', 'd'))).toBe(true);
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isApiError('nope')).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});
