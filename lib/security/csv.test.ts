import { describe, it, expect } from 'vitest';
import { sanitizeCsvCell, sanitizeCsvRows } from './csv';

describe('sanitizeCsvCell', () => {
  it('prefixes a leading formula trigger with an apostrophe', () => {
    expect(sanitizeCsvCell('=cmd|/c calc')).toBe("'=cmd|/c calc");
    expect(sanitizeCsvCell('+1 514 555 0000')).toBe("'+1 514 555 0000");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCsvCell('\tTAB')).toBe("'\tTAB");
    expect(sanitizeCsvCell('\rCR')).toBe("'\rCR");
  });

  it('leaves safe strings untouched (only a LEADING trigger matters)', () => {
    expect(sanitizeCsvCell('Jean Tremblay')).toBe('Jean Tremblay');
    expect(sanitizeCsvCell('a=b')).toBe('a=b');
    expect(sanitizeCsvCell('')).toBe('');
  });

  it('passes non-strings through unchanged', () => {
    expect(sanitizeCsvCell(42)).toBe(42);
    expect(sanitizeCsvCell(null)).toBe(null);
    expect(sanitizeCsvCell(undefined)).toBe(undefined);
  });
});

describe('sanitizeCsvRows', () => {
  it('sanitizes every string cell across rows, leaving numbers intact', () => {
    const rows = [{ name: '=HYPERLINK("http://evil")', price: 10, phone: '+15145550000' }];
    expect(sanitizeCsvRows(rows)).toEqual([
      { name: '\'=HYPERLINK("http://evil")', price: 10, phone: "'+15145550000" },
    ]);
  });
});
