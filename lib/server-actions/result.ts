/**
 * Uniform return type for Server Actions. Every mutating action in the app
 * returns `Result<T, ActionError>`, so client forms can pattern-match on
 * `state.ok` and look up the localized message via `t('errors.' + code)`.
 *
 * `data` lives on the ok branch for convenience (e.g. server returns the new
 * row's id so the client can route to it).
 */
export type Result<T, E extends string = ActionErrorCode> =
  | { ok: true; data: T }
  | { ok: false; errorCode: E; fieldErrors?: Record<string, string> };

export type ActionErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_SHOP'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNEXPECTED';

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(
  errorCode: ActionErrorCode,
  fieldErrors?: Record<string, string>,
): Result<never> {
  return { ok: false, errorCode, fieldErrors };
}
