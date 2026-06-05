/**
 * CSV cell sanitization against spreadsheet formula injection ("CSV injection").
 *
 * Excel / Google Sheets / LibreOffice interpret a cell whose value starts with
 * `=`, `+`, `-`, `@`, a tab (0x09) or a carriage return (0x0D) as a FORMULA.
 * Several exported fields (client names, emails, notes) originate from the
 * public, unauthenticated booking flow, so an attacker can inject e.g.
 * `=cmd|'/c calc'!A1` or `=HYPERLINK("http://evil","click")` that executes or
 * phishes when the shop owner opens the downloaded file.
 *
 * Mitigation (OWASP): prefix any such value with a single quote, which forces
 * spreadsheet apps to treat the cell as text. The leading quote is consumed on
 * display by Excel/Sheets. NANP phone numbers (`+1 …`) get the prefix too —
 * an accepted, harmless cosmetic cost for closing the injection vector.
 */

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function sanitizeCsvCell(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  return FORMULA_TRIGGERS.has(value[0]!) ? `'${value}` : value;
}

export function sanitizeCsvRows<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = sanitizeCsvCell(v);
    return out as T;
  });
}
