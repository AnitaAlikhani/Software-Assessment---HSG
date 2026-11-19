import QRCode from 'qrcode';
import { fileSlug } from './csv';

/**
 * The address customers book at: this site's own address with "?booking=1". Built from the
 * place the app is served from, so it is right on the main site and under a sub-path
 * (a preview of a branch) alike. Whatever else the owner's address carries (the page that is
 * open, an access key, the research switch) stays out of the link customers get.
 */
export function bookingAddress(page: Pick<Location, 'origin' | 'pathname'>): string {
  const address = new URL(page.pathname, page.origin);
  address.searchParams.set('booking', '1');
  return address.href;
}

/** White modules around a QR code. Scanners need four on every side to find the code. */
export const QR_QUIET_ZONE = 4;

/**
 * The QR code of a text: rows of modules, true where a module is dark. Made in the browser, so
 * the link is never sent to another service. Medium error correction: the code stays readable
 * with a crease or a mark on a printed sheet, without growing more than it has to.
 */
export function qrModules(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (_, column) => modules.get(row, column) === 1));
}

/** How many units a side of the drawn code has: the modules and the quiet zone on both sides. */
export const qrSide = (modules: boolean[][]): number => modules.length + 2 * QR_QUIET_ZONE;

/**
 * The dark modules as one SVG path, on a grid of qrSide() units with the quiet zone left free.
 * Neighbours in a row are drawn as one bar, which keeps the path short.
 */
export function qrPath(modules: boolean[][]): string {
  let path = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (row[x + run]) run++;
      path += `M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return path;
}

/** A file name for the saved picture, from the salon's name: "bella-hair-salon-booking-qr.png". */
export function qrFileName(salonName: string): string {
  const name = fileSlug(salonName, '');
  return `${name ? `${name}-` : ''}booking-qr.png`;
}
