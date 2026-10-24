/** Spread pixel readbacks over render intervals, independently of draw order. */
export class TileScheduler {
  private frame = 0;
  private records = new Map<string, { seen: number; sampled: number }>();
  private selected = new Set<string>();
  private sampled = new Set<string>();
  private readonly limit: number;

  constructor(limit = 6) { this.limit = limit; }

  beginFrame() {
    this.frame++;
    this.selected.clear();
    this.sampled.clear();
    // Only reserve slots for tiles seen in the previous render interval. A
    // camera jump therefore cannot keep old, off-screen tiles in the rotation.
    const recent = [...this.records].filter(([, record]) => record.seen === this.frame - 1);
    recent.sort((a, b) => a[1].sampled - b[1].sampled);
    for (const [key] of recent.slice(0, this.limit)) this.selected.add(key);
    for (const [key, record] of this.records) if (record.seen < this.frame - 2) this.records.delete(key);
  }

  includes(key: string): boolean {
    let record = this.records.get(key);
    if (!record) {
      record = { seen: this.frame, sampled: 0 };
      this.records.set(key, record);
    }
    record.seen = this.frame;
    if (!this.selected.has(key)) {
      if (this.selected.size >= this.limit) return false;
      this.selected.add(key);
    }
    // Every layer of a selected tile belongs to the same sample. Keeping it
    // selected prevents fog/layer order from changing the material result.
    if (!this.sampled.has(key)) {
      this.sampled.add(key);
      record.sampled = this.frame;
    }
    return true;
  }

  clear() { this.frame = 0; this.records.clear(); this.selected.clear(); this.sampled.clear(); }
}
