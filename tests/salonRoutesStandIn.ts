import type { SalonRequest, ServerAnswer, TabChannel, TabMessage } from '../src/sharedSalon';

/**
 * A stand-in for the four routes of the salon on the server (GET, PUT and DELETE /api/salon,
 * the contract of delivery 3B), for the tests of the owner's app. It keeps one record in memory
 * that several "devices" share, and does on demand what the real server may do: refuse a part
 * with its sentence, fail, be out of reach, make the caller wait (429), or answer late. No
 * network is used; the real routes are tested on the server's side.
 */

export interface SalonRecord { rev: number; updatedAt: string; parts: Record<string, unknown> }

export interface LoggedRequest { method: string; key: string; body?: unknown }

export class SalonRoutesStandIn {
  record: SalonRecord | null = null;
  readonly log: LoggedRequest[] = [];
  /** The key the server accepts. */
  key = 'owner-key';
  /** A part the server refuses, with the sentence it gives. */
  refuse: { part: string; sentence: string } | null = null;
  /** What the next requests get instead of an answer: no answer at all, or a status with a sentence. */
  failNext: Array<null | { status: number; error?: string }> = [];
  /** Stored parts the server says it could not read (`unreadable` in GET and in a 409). */
  unreadable: string[] = [];
  /** While true, answers wait until `release()` is called (a slow server). */
  hold = false;
  private held: Array<() => void> = [];
  private moments = 0;

  /** The request function one device uses. */
  readonly request: SalonRequest = (key, method, body) => {
    this.log.push({ method, key, ...(body === undefined ? {} : { body: JSON.parse(JSON.stringify(body)) }) });
    const answer = new Promise<ServerAnswer | null>((resolve) => {
      // The answer is worked out when it is given, as a real server does when the request arrives.
      const give = () => resolve(this.answer(key, method, body));
      if (this.hold) this.held.push(give); else queueMicrotask(give);
    });
    return answer;
  };

  /** Lets the answers that wait go, in order. */
  release(): void {
    this.hold = false;
    for (const give of this.held.splice(0)) give();
  }

  /** The requests of one kind so far. */
  count(method: string): number { return this.log.filter((item) => item.method === method).length; }
  get puts(): Array<{ baseRev: number; parts: Record<string, unknown> }> {
    return this.log.filter((item) => item.method === 'PUT').map((item) => item.body as { baseRev: number; parts: Record<string, unknown> });
  }

  /** Saves as another device would, without going through a device. */
  saveElsewhere(parts: Record<string, unknown>): number {
    const rev = (this.record?.rev ?? 0) + 1;
    this.record = { rev, updatedAt: this.moment(), parts: { ...this.record?.parts, ...parts } };
    return rev;
  }

  private moment(): string {
    this.moments += 1;
    return new Date(Date.UTC(2026, 9, 5, 10, 0, this.moments)).toISOString();
  }

  private answer(key: string, method: string, body: unknown): ServerAnswer | null {
    if (this.failNext.length > 0) {
      const failure = this.failNext.shift()!;
      return failure && { status: failure.status, data: failure.error ? { error: failure.error } : null };
    }
    if (key !== this.key) return { status: 401, data: { error: 'Not allowed.' } };
    const extra = this.unreadable.length ? { unreadable: [...this.unreadable] } : {};
    if (method === 'GET') return { status: 200, data: { ...(this.record ? JSON.parse(JSON.stringify(this.record)) : { rev: 0, parts: {} }), ...extra } };
    // An existing record stays, with the next revision and no parts; without one there is nothing to count on.
    if (method === 'DELETE') {
      if (!this.record) return { status: 200, data: { rev: 0 } };
      this.record = { rev: this.record.rev + 1, updatedAt: this.moment(), parts: {} };
      return { status: 200, data: { rev: this.record.rev, updatedAt: this.record.updatedAt } };
    }
    const { baseRev, parts } = body as { baseRev: number; parts: Record<string, unknown> };
    if (this.refuse && this.refuse.part in parts) return { status: 400, data: { error: this.refuse.sentence } };
    const rev = this.record?.rev ?? 0;
    if (baseRev !== rev) return { status: 409, data: { error: 'Changed elsewhere.', ...(this.record ? JSON.parse(JSON.stringify(this.record)) : { rev: 0, parts: {} }), ...extra } };
    this.record = { rev: rev + 1, updatedAt: this.moment(), parts: { ...this.record?.parts, ...JSON.parse(JSON.stringify(parts)) } };
    return { status: 200, data: { rev: this.record.rev, updatedAt: this.record.updatedAt } };
  }
}

/** The channel between the tabs of one browser, as BroadcastChannel gives it: a message reaches every other tab. */
export class TabsStandIn {
  private readonly receivers: Array<{ owner: number; receive: (message: TabMessage) => void }> = [];
  private tabs = 0;
  readonly sent: TabMessage[] = [];
  /** The channel of one tab. */
  open(): TabChannel {
    const owner = ++this.tabs;
    return {
      post: (message) => {
        this.sent.push(message);
        for (const receiver of [...this.receivers]) if (receiver.owner !== owner) receiver.receive(JSON.parse(JSON.stringify(message)));
      },
      listen: (receive) => {
        const entry = { owner, receive };
        this.receivers.push(entry);
        return () => { this.receivers.splice(this.receivers.indexOf(entry), 1); };
      },
    };
  }
}
