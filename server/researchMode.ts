import process from 'node:process';

/**
 * The server-side twin of the "?research=1" link (src/flags.ts): with RESEARCH_MODE=1 the
 * messenger channels keep the study wording for research participants. Without it, customers
 * read the product wording. A messenger chat has no address to carry the switch, so it is a setting.
 */
export const researchSetting = (env: Record<string, string | undefined> = process.env): boolean =>
  env.RESEARCH_MODE?.trim() === '1';
