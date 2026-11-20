import type { ErrorCode, ErrorDetail } from './errors.js';

/** Response envelope (docs/API_CONTRACTS.md §1, D31). */
export interface SuccessEnvelope<T, M extends object = Record<string, never>> {
  success: true;
  data: T;
  meta?: M;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

export type ApiEnvelope<T, M extends object = Record<string, never>> =
  SuccessEnvelope<T, M> | ErrorEnvelope;

export function successEnvelope<T>(data: T): SuccessEnvelope<T>;
export function successEnvelope<T, M extends object>(data: T, meta: M): SuccessEnvelope<T, M>;
export function successEnvelope<T, M extends object>(
  data: T,
  meta?: M,
): SuccessEnvelope<T, M> | SuccessEnvelope<T> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

export function errorEnvelope(input: {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: ErrorDetail[];
}): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = {
    code: input.code,
    message: input.message,
    requestId: input.requestId,
  };
  if (input.details !== undefined && input.details.length > 0) {
    error.details = input.details;
  }
  return { success: false, error };
}
