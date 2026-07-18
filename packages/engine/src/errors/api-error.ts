export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends ApiError {
  constructor(streamType: string, id: string) {
    super('not_found', `${streamType} '${id}' not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class AlreadyExistsError extends ApiError {
  constructor(streamType: string, id: string) {
    super('already_exists', `${streamType} '${id}' already exists`, 409);
    this.name = 'AlreadyExistsError';
  }
}

export class InvalidStateError extends ApiError {
  constructor(message: string) {
    super('invalid_state', message, 409);
    this.name = 'InvalidStateError';
  }
}

export class ConcurrencyError extends ApiError {
  constructor(message: string) {
    super('concurrency_conflict', message, 503);
    this.name = 'ConcurrencyError';
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
