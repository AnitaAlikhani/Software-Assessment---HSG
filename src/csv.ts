/** Quote every field so separators, quotes and line breaks stay in their cells. */
export function csvCell(value: string | number): string {
  const text = String(value);
  // Spreadsheets may execute text beginning with a formula marker, so such text gets an
  // apostrophe in front, on export only. A phone number in international form also starts with a
  // plus sign, but a plus followed by nothing except digits and spaces cannot call a function or
  // name a cell, so it stays as it is: the apostrophe would show in every row of the customer list.
  const risky = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text) && !/^\+\d[\d ]{5,22}$/.test(text);
  const safe = risky ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// One separator for every export. Excel on Windows with Swiss, German, French or Italian regional
// settings splits a file it opens by double-click at semicolons only; with commas the whole row
// lands in one cell. Numbers, Google Sheets and LibreOffice recognise the semicolon by themselves.
// (Excel on a Mac set to a region with a decimal point expects a comma: there the file needs
// Data > From Text/CSV.)
const SEPARATOR = ';';

/** The rows as the text of a CSV file. It starts with a byte-order mark, so spreadsheets read the umlauts as UTF-8. */
export function createCsv(rows: readonly (readonly (string | number)[])[]): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(SEPARATOR)).join('\r\n');
}

/**
 * A name for a file name: "Bella Hair Salon" becomes "bella-hair-salon", "Müller & Söhne"
 * "mueller-soehne". Only letters and digits that every file system and mail program accepts stay.
 * A name that leaves nothing (one written in another script) gives the fallback.
 */
export function fileSlug(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** Hands the rows to the browser as a CSV file to save. Only call it from a click: browsers block other downloads. */
export function downloadCsv(fileName: string, rows: readonly (readonly (string | number)[])[]): void {
  const url = URL.createObjectURL(new Blob([createCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // The browser reads the file after the click returns; release it a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
