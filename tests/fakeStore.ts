/**
 * Stand-ins for the tests of the live chat: the storage in memory with a clock the test controls,
 * and a way to run code "as deployed" with given settings. Nothing leaves the test.
 */
import { DELETE_SCRIPT, forgetEarlierListCleaning, SAVE_SCRIPT } from '../server/store';

export type Command = (string | number)[];

interface Entry {
  value: string | Set<string>;
  expiresAt?: number;
}

/**
 * The storage (Upstash Redis) in memory. It knows exactly the commands the store uses, and the
 * ones the earlier version used, so a test can lay out what that version left behind. Any other
 * command, or a command on a key of the wrong kind, fails as it would on the real storage, so a
 * test notices a change that would break chats saved earlier.
 *
 * The real storage runs the store's two scripts in Lua. Here they are recognised by their text
 * and answered by the same steps in TypeScript (see `script`). A script the store changes without
 * changing this file is unknown here and fails every test that uses it.
 */
export class FakeStore {
  readonly commands: Command[] = [];
  private readonly entries = new Map<string, Entry>();
  /** SCAN looks at no more keys per call than this, whatever COUNT asks for. Lower it and a listing takes several calls. */
  scanStep = Number.POSITIVE_INFINITY;
  /** The real SCAN may name a key twice. With this on, every call after the first names the last key of the call before again. */
  scanRepeats = false;

  constructor(public now: number) {}

  /** Lets time pass. Keys whose time is up are gone, as in the real storage. */
  advance(ms: number) { this.now += ms; }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now) { this.entries.delete(key); return undefined; }
    return entry;
  }

  private set(key: string, create: boolean): Entry | undefined {
    const entry = this.live(key);
    if (entry && !(entry.value instanceof Set)) throw new Error(`WRONGTYPE ${key} holds a text, not a set`);
    if (entry || !create) return entry;
    const created: Entry = { value: new Set<string>() };
    this.entries.set(key, created);
    return created;
  }

  keys(): string[] { return [...this.entries.keys()].filter(key => this.live(key)).sort(); }
  text(key: string): string | null { const value = this.live(key)?.value; return typeof value === 'string' ? value : null; }
  members(key: string): string[] { const value = this.live(key)?.value; return value instanceof Set ? [...value].sort() : []; }
  /** Seconds until the key deletes itself; null when it never does or does not exist. */
  secondsLeft(key: string): number | null {
    const entry = this.live(key);
    return entry?.expiresAt === undefined ? null : Math.round((entry.expiresAt - this.now) / 1000);
  }
  /** Every key that still holds the given text: in its name, in its stored text or as a member of its set. */
  holding(text: string): string[] {
    return this.keys().filter(key => key.includes(text) || (this.text(key) ?? '').includes(text) || this.members(key).some(member => member.includes(text)));
  }

  /** One command from outside. It is written down; the commands a script runs inside the storage are not. */
  run(command: Command): unknown {
    this.commands.push(command);
    return this.execute(command.map(String));
  }

  private execute([name, key, ...rest]: string[]): unknown {
    switch (name) {
      case 'GET': {
        const entry = this.live(key);
        if (entry?.value instanceof Set) throw new Error(`WRONGTYPE ${key} holds a set, not a text`);
        return entry?.value ?? null;
      }
      case 'SET': {
        const [value, ...options] = rest;
        if (options.includes('NX') && this.live(key)) return null;
        const seconds = options.includes('EX') ? Number(options[options.indexOf('EX') + 1]) : undefined;
        if (seconds !== undefined && !(Number.isInteger(seconds) && seconds > 0)) throw new Error('ERR invalid expire time');
        this.entries.set(key, { value, expiresAt: seconds === undefined ? undefined : this.now + seconds * 1000 });
        return 'OK';
      }
      case 'MGET':
        return [key, ...rest].map(item => { const value = this.live(item)?.value; return typeof value === 'string' ? value : null; });
      case 'DEL':
        return [key, ...rest].filter(item => this.live(item) && this.entries.delete(item)).length;
      case 'SADD': {
        const members = this.set(key, true)!.value as Set<string>;
        return rest.filter(member => !members.has(member) && members.add(member)).length;
      }
      case 'SREM': {
        const entry = this.set(key, false);
        if (!entry) return 0;
        const members = entry.value as Set<string>;
        const removed = rest.filter(member => members.delete(member)).length;
        if (members.size === 0) this.entries.delete(key); // an empty set does not exist
        return removed;
      }
      case 'SMEMBERS':
        return [...((this.set(key, false)?.value as Set<string> | undefined) ?? [])];
      case 'EXPIRE': {
        const entry = this.live(key);
        const seconds = Number(rest[0]);
        if (!(Number.isInteger(seconds) && seconds > 0)) throw new Error('ERR invalid expire time');
        if (entry) entry.expiresAt = this.now + seconds * 1000;
        return entry ? 1 : 0;
      }
      case 'SCAN': {
        // SCAN <cursor> MATCH <prefix>* COUNT <n>: looks at up to n keys from the cursor on and
        // names those that match. COUNT is how many keys it looks at, not how many it names.
        // The cursor "0" starts a listing, and the answer "0" ends it.
        const [match, pattern, count, asked] = rest;
        const prefix = pattern?.slice(0, -1) ?? '';
        if (match !== 'MATCH' || count !== 'COUNT' || !pattern?.endsWith('*') || /[*?[\]\\]/.test(prefix)) {
          throw new Error('ERR the storage stand-in only knows SCAN <cursor> MATCH <prefix>* COUNT <n>');
        }
        const step = Math.min(Number(asked), this.scanStep);
        if (!(Number.isInteger(step) && step > 0)) throw new Error('ERR value is not an integer or out of range');
        const all = this.keys();
        const from = Number(key);
        const looked = all.slice(from, from + step);
        if (this.scanRepeats && from > 0) looked.unshift(all[from - 1]);
        return [from + step >= all.length ? '0' : String(from + step), looked.filter(item => item.startsWith(prefix))];
      }
      case 'EVAL': {
        const [numberOfKeys, ...parts] = rest;
        return this.script(key, parts.slice(0, Number(numberOfKeys)), parts.slice(Number(numberOfKeys)));
      }
      default:
        throw new Error(`ERR unknown command ${name}`);
    }
  }

  /**
   * The store's two scripts, line for line as the Lua does it. Like the real storage, nothing
   * else runs between the steps of one script.
   */
  private script(script: string, keys: string[], args: string[]): unknown {
    if (script === SAVE_SCRIPT && keys.length === 2 && args.length === 3) {
      const marker = this.execute(['GET', keys[1]]);
      if (marker !== null && marker !== args[0]) return 0;
      this.execute(['SET', keys[0], args[1], 'EX', args[2]]);
      return 1;
    }
    if (script === DELETE_SCRIPT && keys.length === 3 && args.length === 3) {
      this.execute(['SET', keys[1], args[0], 'EX', args[1]]);
      const deleted = this.execute(['DEL', keys[0]]);
      this.execute(['SREM', keys[2], args[2]]);
      return deleted;
    }
    throw new Error('ERR the storage stand-in does not know this script, or it got the wrong number of keys and values');
  }
}

const SETTINGS = ['VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'LIVE_DATA_SPACE', 'LIVE_ACCESS_KEY', 'RESEARCH_MODE', 'GEMINI_API_KEY', 'GEMINI_MODEL',
  'TELEGRAM_BOT_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_GRAPH_VERSION',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
const STORAGE_URL = 'https://storage.invalid';

export interface Deployment {
  /** The storage to use. Without one, a fresh empty storage at time 0. */
  store?: FakeStore;
  /**
   * Answers every call that does not go to the storage (a messenger, the AI). Without it, such a
   * call fails the test. It may take its time (a promise), so a test can let something else
   * happen while the AI is "thinking". It may return a ready Response to answer with an error
   * status, or throw to stand for a connection that failed.
   */
  outside?: (url: string, body: string) => unknown;
}

/**
 * Runs `work` as if the site were deployed with exactly these settings: a newly started instance
 * that remembers nothing from earlier runs. The storage is the in-memory one and every other
 * network call fails unless `outside` answers it, so nothing leaves the test. Everything is put
 * back afterwards. Returns the storage commands in the order they ran.
 */
export async function deployedWith(settings: Record<string, string>, work: () => Promise<unknown>, { store = new FakeStore(0), outside }: Deployment = {}): Promise<Command[]> {
  const before = new Map(SETTINGS.map(name => [name, process.env[name]]));
  const realFetch = globalThis.fetch;
  const first = store.commands.length;
  for (const name of SETTINGS) delete process.env[name];
  Object.assign(process.env, { KV_REST_API_URL: STORAGE_URL, KV_REST_API_TOKEN: 'test-token' }, settings);
  forgetEarlierListCleaning();
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === STORAGE_URL) {
      try { return json({ result: store.run(JSON.parse(body) as Command) }); }
      catch (error) { return json({ error: String((error as Error).message) }, 400); }
    }
    if (!outside) throw new Error(`unexpected network call to ${url}`);
    const answer = await outside(url, body);
    return answer instanceof Response ? answer : json(answer);
  }) as typeof fetch;
  try { await work(); }
  finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  return store.commands.slice(first);
}
