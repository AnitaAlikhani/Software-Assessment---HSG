/**
 * Study tools are hidden from normal visitors: the pilot banner and "Register interest",
 * "Simulate incoming booking", the live-test strip and the study notice in the customer chat.
 *
 * A study link switches them on: add ?research=1 to any address once. ?research=0 switches them
 * off again. The choice is remembered in this browser, so later pages need no parameter.
 */
export const RESEARCH_STORAGE_KEY = 'slotbee-research';

type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The rule itself, without touching the browser: the address wins, then the remembered choice. */
export function readResearchMode(search: string, storage?: ChoiceStorage | null): boolean {
  const choice = new URLSearchParams(search).get('research');
  if (choice === '1' || choice === '0') {
    try {
      if (choice === '1') storage?.setItem(RESEARCH_STORAGE_KEY, '1');
      else storage?.removeItem(RESEARCH_STORAGE_KEY);
    } catch { /* Storage can be unavailable in privacy modes; the address still decides this visit. */ }
    return choice === '1';
  }
  try { return storage?.getItem(RESEARCH_STORAGE_KEY) === '1'; } catch { return false; }
}

let current: boolean | undefined;

/** Whether study tools are shown in this browser. Read once per page load. */
export function researchMode(): boolean {
  if (current === undefined) {
    let storage: ChoiceStorage | null = null;
    try { storage = typeof localStorage === 'undefined' ? null : localStorage; } catch { storage = null; }
    current = typeof window === 'undefined' ? false : readResearchMode(window.location.search, storage);
  }
  return current;
}

/** Tests only: force the mode, or pass undefined to read it again. */
export function setResearchModeForTests(value: boolean | undefined): void {
  current = value;
}
