/** Quote every field so commas, quotes and line breaks stay in their cells. */
export function csvCell(value: string | number): string {
  const text = String(value);
  // Spreadsheets may execute text beginning with a formula marker. Prefix text
  // (including international phone numbers) with an apostrophe on export only.
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createCsv(rows: readonly (readonly (string | number)[])[]): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
