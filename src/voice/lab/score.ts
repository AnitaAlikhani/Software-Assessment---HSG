/**
 * How well a heard text carries what was said.
 *
 * A booking needs a few details to arrive: the day, the time, the service, the name. Engines write
 * the same detail in many ways ("3 pm", "3:00 p.m.", "15:00"), so each detail lists the spellings
 * that count. The share of words that differ is reported too, as a second, stricter number.
 */

/** One detail a sentence carries. */
export interface KeyItem {
  /** How the page names the detail, for example "15:30". */
  label: string;
  /** Spellings that count, tested against the simplified text (see simplify). */
  accept?: RegExp[];
  /** For a phone number: these digits must appear in this order, however they are grouped. */
  digits?: string;
}

export interface LabSentence {
  id: string;
  /** What the person reads aloud. */
  text: string;
  /** The details that have to arrive. Empty for small talk, where nothing bookable is said. */
  keys: KeyItem[];
}

/**
 * Lower case and no punctuation: "Färben, 3 p.m." becomes "färben 3 pm". Umlauts stay, because
 * "Färben" and "Farben" are different words; "ß" becomes "ss", the Swiss spelling.
 * A dot or colon between two digits stays, so "10:30" and "27.11" keep their shape.
 */
export function simplify(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\b([ap])\.?\s?m\b\.?/g, '$1m')
    .replace(/[^a-z0-9äöü:.\s]/g, ' ')
    .replace(/[.:]/g, (mark, offset: number, whole: string) =>
      /\d/.test(whole[offset - 1] ?? '') && /\d/.test(whole[offset + 1] ?? '') ? mark : ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the heard text carries this detail. */
export function hears(item: KeyItem, heard: string): boolean {
  if (item.digits !== undefined) return heard.replace(/\D/g, '').includes(item.digits);
  const simple = simplify(heard);
  return (item.accept ?? []).some(pattern => pattern.test(simple));
}

/**
 * The share of words that differ from what was read: 0 is word for word, 1 is nothing right.
 * Counted on the simplified texts, as the fewest words to change, add or drop.
 */
export function wordErrors(expected: string, heard: string): number {
  const said = simplify(expected).split(' ').filter(Boolean);
  const got = simplify(heard).split(' ').filter(Boolean);
  if (said.length === 0) return got.length === 0 ? 0 : 1;
  let previous = got.map((_, index) => index + 1);
  for (let row = 0; row < said.length; row++) {
    const current: number[] = [];
    let left = row + 1;
    let diagonal = row;
    for (let column = 0; column < got.length; column++) {
      const cost = Math.min(previous[column] + 1, left + 1, diagonal + (said[row] === got[column] ? 0 : 1));
      diagonal = previous[column];
      current.push(cost);
      left = cost;
    }
    previous = current;
  }
  const distance = got.length === 0 ? said.length : previous[got.length - 1];
  return Math.min(1, distance / said.length);
}

export interface SentenceScore {
  /** One entry per detail of the sentence, in the same order. */
  found: boolean[];
  foundCount: number;
  total: number;
  /** See wordErrors. */
  wordErrors: number;
}

export function scoreSentence(sentence: LabSentence, heard: string): SentenceScore {
  const found = sentence.keys.map(item => hears(item, heard));
  return {
    found,
    foundCount: found.filter(Boolean).length,
    total: found.length,
    wordErrors: Math.round(wordErrors(sentence.text, heard) * 100) / 100,
  };
}
