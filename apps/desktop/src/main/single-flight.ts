export class SingleFlightByKey<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const next = Promise.resolve().then(task);
    this.pending.set(key, next);
    const clear = () => {
      if (this.pending.get(key) === next) this.pending.delete(key);
    };
    void next.then(clear, clear);
    return next;
  }
}
