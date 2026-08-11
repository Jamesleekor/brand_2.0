// B.R.A.N.D 2.0 — Feature4 fault-isolation helpers
export type Feature4Domain = 'F4A' | 'F4B' | 'F4C' | 'F4D';

export function feature4QueryError(domain: Feature4Domain, operation: string, error: unknown): Error {
  const raw = error as { message?: string; code?: string; details?: string; hint?: string } | null;
  const message = raw?.message ?? (error instanceof Error ? error.message : String(error));
  console.error(`[B.R.A.N.D Feature4 ${domain}] query failed: ${operation}`, {
    domain,
    operation,
    code: raw?.code,
    message,
    details: raw?.details,
    hint: raw?.hint,
    raw: error,
  });
  return new Error(`[${domain}:${operation}] ${message}`);
}
