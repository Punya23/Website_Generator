export interface MediaRegistryEntry {
  url: string;
  query: string;
  blockId: string;
  sectionId?: string;
  pageSlug?: string;
}

export class MediaRegistry {
  private entries: MediaRegistryEntry[] = [];

  get usedUrls(): Set<string> {
    return new Set(this.entries.map((e) => e.url));
  }

  isDuplicate(url: string): boolean {
    return this.usedUrls.has(url);
  }

  register(entry: MediaRegistryEntry): void {
    this.entries.push(entry);
  }

  /** Vary query so stock resolver returns a different asset when URL would repeat. */
  uniqueQuery(base: string, blockId: string, sectionId?: string): string {
    const prior = this.entries.filter((e) => e.query.startsWith(base.split(" ")[0] ?? base));
    if (prior.length === 0) return base;
    return `${base} ${blockId} view ${prior.length + 1}`;
  }

  toJSON(): MediaRegistryEntry[] {
    return [...this.entries];
  }

  static fromJSON(entries: MediaRegistryEntry[]): MediaRegistry {
    const r = new MediaRegistry();
    r.entries = [...entries];
    return r;
  }
}
