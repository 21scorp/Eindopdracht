/**
 * Persistence.
 *
 * Save data is versioned from day one and runs through a migration chain on
 * load. Players keep their Guardians across updates; that is non-negotiable for
 * a game with a collection, and retrofitting migrations later is painful.
 *
 * localStorage can throw (private mode, quota, disabled cookies). Every path
 * degrades to an in-memory store so the game still runs, just without saving.
 */

export type Migration<T = unknown> = (data: T) => T;

export interface StoreOptions<T> {
  key: string;
  version: number;
  defaults: () => T;
  /** Keyed by the version being migrated *from*. */
  migrations?: Record<number, Migration>;
  /** Called after load so the game can repair or clamp fields. */
  validate?: (data: T) => T;
}

interface Envelope {
  __v: number;
  __savedAt: number;
  data: unknown;
}

function createBackend(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const probe = '__aegis_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    console.warn('[Storage] localStorage unavailable — progress will not persist this session.');
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

const backend = createBackend();

export class Store<T> {
  private cache: T;
  private dirty = false;
  private flushHandle: number | null = null;

  constructor(private readonly options: StoreOptions<T>) {
    this.cache = this.load();
  }

  get data(): T {
    return this.cache;
  }

  /** Mutate and schedule a debounced write. */
  update(mutator: (data: T) => void): void {
    mutator(this.cache);
    this.markDirty();
  }

  /** Replace the whole payload. */
  replace(data: T): void {
    this.cache = data;
    this.markDirty();
  }

  reset(): void {
    this.cache = this.options.defaults();
    this.flush();
  }

  markDirty(): void {
    this.dirty = true;
    if (this.flushHandle !== null) return;
    // Batch writes: gameplay can touch the save many times in a single frame.
    this.flushHandle = window.setTimeout(() => {
      this.flushHandle = null;
      this.flush();
    }, 250);
  }

  flush(): void {
    if (this.flushHandle !== null) {
      clearTimeout(this.flushHandle);
      this.flushHandle = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const envelope: Envelope = {
      __v: this.options.version,
      __savedAt: Date.now(),
      data: this.cache,
    };
    try {
      backend.setItem(this.options.key, JSON.stringify(envelope));
    } catch (err) {
      console.warn('[Storage] write failed', err);
    }
  }

  private load(): T {
    let raw: string | null = null;
    try {
      raw = backend.getItem(this.options.key);
    } catch {
      raw = null;
    }
    if (!raw) return this.options.defaults();

    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      console.warn('[Storage] corrupt save, starting fresh');
      return this.options.defaults();
    }

    let version = typeof envelope.__v === 'number' ? envelope.__v : 0;
    let data = envelope.data;

    if (version > this.options.version) {
      // Save came from a newer build. Refuse to guess; keep it untouched by
      // starting fresh in memory rather than writing over it.
      console.warn('[Storage] save is from a newer version, using defaults without overwriting');
      return this.options.defaults();
    }

    const migrations = this.options.migrations ?? {};
    while (version < this.options.version) {
      const migrate = migrations[version];
      if (!migrate) {
        console.warn(`[Storage] no migration from v${version}; starting fresh`);
        return this.options.defaults();
      }
      data = migrate(data);
      version++;
    }

    const merged = mergeDefaults(this.options.defaults(), data) as T;
    return this.options.validate ? this.options.validate(merged) : merged;
  }

  /** Export the raw save so players can back it up or move devices. */
  export(): string {
    return btoa(unescape(encodeURIComponent(JSON.stringify({ __v: this.options.version, data: this.cache }))));
  }

  /** Import a previously exported save. Returns false if it could not be read. */
  import(encoded: string): boolean {
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded.trim())))) as Envelope;
      if (typeof parsed?.__v !== 'number') return false;
      const merged = mergeDefaults(this.options.defaults(), parsed.data) as T;
      this.cache = this.options.validate ? this.options.validate(merged) : merged;
      this.dirty = true;
      this.flush();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Deep-merge a loaded payload over freshly built defaults, so fields added in a
 * later build appear without needing a migration for every additive change.
 * Arrays are taken wholesale from the save — they are data, not structure.
 */
export function mergeDefaults(defaults: unknown, saved: unknown): unknown {
  if (saved === undefined || saved === null) return defaults;
  if (Array.isArray(defaults) || Array.isArray(saved)) return saved;
  if (typeof defaults !== 'object' || typeof saved !== 'object') return saved;

  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
    out[key] = key in out ? mergeDefaults(out[key], value) : value;
  }
  return out;
}
