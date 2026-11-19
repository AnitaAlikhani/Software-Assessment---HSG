/**
 * Reads a QR code the way a phone camera does once it has found the modules: format bits,
 * unmasking, the zigzag of data modules, the blocks with their error correction, and the text.
 * Written from the QR standard (ISO/IEC 18004) and independent of the library that draws the
 * codes, so a test can prove that a drawn code really holds the address it was made for.
 *
 * It reads clean codes of versions 1 to 10 (up to about 200 characters), which covers every
 * booking address. It does not repair damage: a single wrong module makes it fail, on purpose.
 */

type Level = 'L' | 'M' | 'Q' | 'H';

/** Per version and level: error correction codewords per block, then [blocks, data codewords per block] groups. */
const BLOCKS: Record<Level, [number, ...[number, number][]][]> = {
  L: [[7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]], [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]]],
  M: [[10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]],
  Q: [[13, [1, 13]], [22, [1, 22]], [18, [2, 17]], [26, [2, 24]], [18, [2, 15], [2, 16]], [24, [4, 19]], [18, [2, 14], [4, 15]], [22, [4, 18], [2, 19]], [20, [4, 16], [4, 17]], [24, [6, 19], [2, 20]]],
  H: [[17, [1, 9]], [28, [1, 16]], [22, [2, 13]], [16, [4, 9]], [22, [2, 11], [2, 12]], [28, [4, 15]], [26, [4, 13], [1, 14]], [26, [4, 14], [2, 15]], [24, [4, 12], [4, 13]], [28, [6, 15], [2, 16]]],
};
/** Centres of the alignment patterns, per version. */
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const LEVELS: Level[] = ['M', 'L', 'H', 'Q']; // by the two level bits 00, 01, 10, 11
const MASKS: ((row: number, column: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// Arithmetic in the field the error correction uses: GF(256) with x^8 + x^4 + x^3 + x^2 + 1.
const EXP: number[] = [];
const LOG: number[] = [];
for (let i = 0, value = 1; i < 255; i++) { EXP[i] = value; LOG[value] = i; value <<= 1; if (value & 0x100) value ^= 0x11d; }
const multiply = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);
/** True when a block (data, then error correction) is a valid Reed-Solomon word: all syndromes are zero. */
const blockIsValid = (block: number[], correction: number): boolean =>
  Array.from({ length: correction }, (_, power) => block.reduce((sum, codeword) => multiply(sum, EXP[power]) ^ codeword, 0)).every((syndrome) => syndrome === 0);

/** The 15 format bits are protected by a BCH code: the remainder of a valid word is zero. */
const formatIsValid = (word: number): boolean => {
  let rest = word;
  for (let bit = 14; bit >= 10; bit--) if (rest & (1 << bit)) rest ^= 0x537 << (bit - 10);
  return rest === 0;
};

export interface DecodedQr {
  text: string;
  version: number;
  level: Level;
  mask: number;
  /** The kinds of segments the text was stored in, in order. */
  modes: ('numeric' | 'alphanumeric' | 'byte')[];
}

/** Decodes a square of modules (true = dark, no quiet zone). Throws with the reason when the code is not valid. */
export function decodeQr(modules: boolean[][]): DecodedQr {
  const size = modules.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10 || modules.some((row) => row.length !== size)) throw new Error(`not a QR code of version 1 to 10: ${size} modules a side`);
  const dark = (row: number, column: number) => modules[row][column];

  // The three finder patterns, by which a camera finds the code: a dark 7x7 ring around a 3x3 core.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      if (dark(top + r, left + c) !== (ring !== 2)) throw new Error(`finder pattern at ${top},${left} is damaged`);
    }
  }
  // The timing patterns between them alternate, starting dark.
  for (let i = 8; i < size - 8; i++) if (dark(6, i) !== (i % 2 === 0) || dark(i, 6) !== (i % 2 === 0)) throw new Error('timing pattern is damaged');

  // Format information: the level of error correction and the mask, stored twice.
  const first = [0, 1, 2, 3, 4, 5, 7, 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1].reduce((word, row, bit) => word | (Number(dark(row, 8)) << bit), 0);
  const second = [size - 1, size - 2, size - 3, size - 4, size - 5, size - 6, size - 7, size - 8, 7, 5, 4, 3, 2, 1, 0].reduce((word, column, bit) => word | (Number(dark(8, column)) << bit), 0);
  if (first !== second) throw new Error('the two copies of the format information differ');
  const format = first ^ 0x5412;
  if (!formatIsValid(format)) throw new Error('format information is not a valid word');
  const level = LEVELS[format >> 13];
  const mask = (format >> 10) & 7;
  if (!dark(size - 8, 8)) throw new Error('the dark module is missing');

  // Modules that carry no data: finders with their separators and format bits, timing, alignment, version.
  const reserved = modules.map((row) => row.map(() => false));
  const reserve = (top: number, left: number, height: number, width: number) => {
    for (let r = top; r < top + height; r++) for (let c = left; c < left + width; c++) reserved[r][c] = true;
  };
  reserve(0, 0, 9, 9); reserve(0, size - 8, 9, 8); reserve(size - 8, 0, 8, 9);
  reserve(6, 0, 1, size); reserve(0, 6, size, 1);
  const centres = ALIGNMENT[version - 1];
  for (const r of centres) for (const c of centres) {
    const onFinder = (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
    if (!onFinder) reserve(r - 2, c - 2, 5, 5);
  }
  if (version >= 7) { reserve(0, size - 11, 6, 3); reserve(size - 11, 0, 3, 6); }

  // Data modules in their order: column pairs from the right, upwards and downwards in turn.
  const bits: number[] = [];
  let upwards = true;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1; // the timing column takes no part
    for (let step = 0; step < size; step++) {
      const row = upwards ? size - 1 - step : step;
      for (const c of [column, column - 1]) if (!reserved[row][c]) bits.push(Number(dark(row, c) !== MASKS[mask](row, c)));
    }
    upwards = !upwards;
  }
  const codewords: number[] = [];
  for (let at = 0; at + 8 <= bits.length; at += 8) codewords.push(bits.slice(at, at + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  // The codewords of the blocks are woven into each other: data first, then error correction.
  const [correction, ...groups] = BLOCKS[level][version - 1];
  const lengths = groups.flatMap(([count, data]) => Array.from({ length: count }, () => data));
  const blocks = lengths.map(() => [] as number[]);
  let next = 0;
  for (let i = 0; i < Math.max(...lengths); i++) blocks.forEach((block, index) => { if (i < lengths[index]) block.push(codewords[next++]); });
  for (let i = 0; i < correction; i++) blocks.forEach((block) => block.push(codewords[next++]));
  if (next > codewords.length) throw new Error('the code holds fewer codewords than its version needs');
  blocks.forEach((block, index) => { if (!blockIsValid(block, correction)) throw new Error(`block ${index + 1} does not match its error correction`); });

  // The text: segments, each with a mode, a length and its characters.
  const data = blocks.flatMap((block, index) => block.slice(0, lengths[index]));
  let position = 0;
  const read = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++, position++) value = (value << 1) | ((data[position >> 3] >> (7 - (position & 7))) & 1);
    return value;
  };
  const wide = version >= 10;
  const modes: DecodedQr['modes'] = [];
  const bytes: number[] = [];
  const push = (text: string) => { for (const byte of new TextEncoder().encode(text)) bytes.push(byte); };
  while (position + 4 <= data.length * 8) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 1) {
      modes.push('numeric');
      let left = read(wide ? 12 : 10);
      for (; left >= 3; left -= 3) push(String(read(10)).padStart(3, '0'));
      if (left === 2) push(String(read(7)).padStart(2, '0'));
      if (left === 1) push(String(read(4)));
    } else if (mode === 2) {
      modes.push('alphanumeric');
      let left = read(wide ? 11 : 9);
      for (; left >= 2; left -= 2) { const pair = read(11); push(ALPHANUMERIC[Math.floor(pair / 45)] + ALPHANUMERIC[pair % 45]); }
      if (left === 1) push(ALPHANUMERIC[read(6)]);
    } else if (mode === 4) {
      modes.push('byte');
      for (let left = read(wide ? 16 : 8); left > 0; left--) bytes.push(read(8));
    } else throw new Error(`mode ${mode} is not one this reader knows`);
  }
  return { text: new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)), version, level, mask, modes };
}

/**
 * The modules of a code drawn as an SVG path of bars ("M x y h width v1 h-width z"), as
 * src/bookingLink.ts draws it. `side` is the width of the picture in modules, quiet zone included.
 */
export function modulesFromPath(path: string, side: number, quietZone: number): boolean[][] {
  const size = side - 2 * quietZone;
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const bars = Array.from(path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g));
  if (bars.map((bar) => bar[0]).join('') !== path) throw new Error('the path holds something that is no bar');
  for (const [, x, y, width, back] of bars) {
    if (width !== back) throw new Error('a bar is not closed');
    for (let column = Number(x); column < Number(x) + Number(width); column++) {
      const row = Number(y) - quietZone;
      // A bar outside the square would lie in the quiet zone, which has to stay white.
      if (row < 0 || row >= size || column - quietZone < 0 || column - quietZone >= size) throw new Error('a bar lies in the quiet zone');
      modules[row][column - quietZone] = true;
    }
  }
  return modules;
}
