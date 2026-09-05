export class OperationScheduler {
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrent = 2) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer');
    }
    this.maxConcurrent = maxConcurrent;
  }

  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      this.drain();
    });

    try {
      return await operation();
    } finally {
      this.activeCount -= 1;
      this.drain();
    }
  }

  getStatus(): { active: number; queued: number; limit: number } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      limit: this.maxConcurrent
    };
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      this.activeCount += 1;
      next();
    }
  }
}
