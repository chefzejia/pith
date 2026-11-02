import type { WorkspaceStoragePort } from "../host.ts";

const queues = new WeakMap<object, MutationQueue>();

export class MutationQueue {
  private tail: Promise<void> = Promise.resolve();

  static forStorage(storage: WorkspaceStoragePort): MutationQueue {
    const identity = storage.mutationIdentity ?? storage;
    let queue = queues.get(identity);
    if (!queue) {
      queue = new MutationQueue();
      queues.set(identity, queue);
    }
    return queue;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
