export type FieldErrors = Record<string, string>;

/** The subset of a Zod schema this helper needs (keeps `zod` out of the web dependencies). */
interface Parser<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/**
 * Validate form values with the same Zod schema the API uses, returning the parsed
 * (normalized) value or a `{ field: message }` map. The server remains authoritative.
 */
export function validateForm<T>(
  schema: Parser<T>,
  values: unknown,
): { ok: true; value: T } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, value: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.map(String).join('.');
    if (errors[field] === undefined) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
