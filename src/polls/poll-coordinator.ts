export class PollCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  get size(): number {
    return this.queues.size;
  }

  run<T>(pollId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pollId) ?? Promise.resolve();
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.queues.set(pollId, completion);

    return previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        release();
        if (this.queues.get(pollId) === completion) {
          this.queues.delete(pollId);
        }
      });
  }
}
