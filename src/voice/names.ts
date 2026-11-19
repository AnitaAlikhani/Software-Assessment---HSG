/**
 * Matching a name as it was heard to the names the salon knows.
 *
 * A speech recogniser spells a name the way it sounds to it: "Leah Bruner" for Lea Brunner,
 * "Luka" for Luca. Each part of the name is reduced to roughly how it sounds, and the heard name
 * is compared with every known one. Nothing leaves the browser for this.
 */

/** Roughly how one part of a name sounds: "Leah" and "Lea" are equal, so are "Brunner" and "Bruner". */
export function soundOf(part: string): string {
  return part
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?![ehiy])/g, 'k')
    .replace(/y/g, 'i')
    .replace(/th/g, 't')
    // An "h" that only lengthens a vowel is not heard: "Leah", "Sarah", "Mahler".
    .replace(/([aeiou])h(?![aeiou])/g, '$1')
    .replace(/(.)\1+/g, '$1');
}

const parts = (name: string): string[] => name.split(/[\s.'’-]+/).map(soundOf).filter(Boolean);

/** How many letters have to change to turn one word into the other. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current.push(Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[b.length];
}

const alike = (a: string, b: string): number => (a === b ? 1 : 1 - distance(a, b) / Math.max(a.length, b.length));

/**
 * How well a heard name fits a known one, from 0 to 1. Every heard part looks for its best
 * partner among the parts of the known name, each of which is used once. A first name alone
 * fits everybody with that first name; a full name that is heard must fit in full.
 *
 * A name of two or more parts only fits when one part sounds exactly the same. "Leah Broner" is
 * Lea Brunner; "Sandro Mayer", a little off in both parts, is somebody else than Sandra Meier.
 */
export function likeness(heard: string, name: string): number {
  const said = parts(heard);
  const known = parts(name);
  if (said.length === 0 || known.length === 0) return 0;
  const free = [...known];
  let total = 0;
  let exact = false;
  for (const part of said) {
    let best = -1;
    let score = 0;
    free.forEach((candidate, index) => {
      const fit = alike(part, candidate);
      if (fit > score) { score = fit; best = index; }
    });
    if (best >= 0) free.splice(best, 1);
    if (score === 1) exact = true;
    total += score;
  }
  if (said.length > 1 && !exact) return 0;
  return Math.round((total / said.length) * 100) / 100;
}

export interface NameFit<Person> {
  person: Person;
  likeness: number;
}

/** A name fits from here on. Below it the two names merely share some letters. */
const FITS = 0.8;
/** The best fit counts as the one that was meant when the next one is this much worse. */
const CLEAR_LEAD = 0.12;

/** The known people whose names fit what was heard, best first. */
export function closestNames<Person extends { name: string }>(heard: string, people: Person[], limit = 3): NameFit<Person>[] {
  return people
    .map(person => ({ person, likeness: likeness(heard, person.name) }))
    .filter(fit => fit.likeness >= FITS)
    .sort((a, b) => b.likeness - a.likeness || a.person.name.localeCompare(b.person.name))
    .slice(0, limit);
}

/**
 * The one person a heard name means, or null when nobody fits or several fit about equally well.
 * Then the owner has to choose (closestNames gives the choices) or the customer is new.
 */
export function matchName<Person extends { name: string }>(heard: string, people: Person[]): Person | null {
  const [first, second] = closestNames(heard, people, 2);
  if (!first) return null;
  return !second || first.likeness - second.likeness >= CLEAR_LEAD ? first.person : null;
}
