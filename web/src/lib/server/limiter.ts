/** Runs a task when a slot is free. `priority`: higher starts sooner (paid plans with priority processing). */
export type Limiter = <T>(task: () => Promise<T>, priority?: number) => Promise<T>;

/**
 * At most `max` tasks at once. Waiting tasks start by priority, then in the order they
 * came; a finishing task hands its slot straight to the next one.
 */
export function limiter(max: number): Limiter {
  let active = 0;
  const waiting: { priority: number; start: () => void }[] = [];
  return async (task, priority = 0) => {
    if (active < max) active++;
    else
      await new Promise<void>((start) => {
        const before = waiting.findIndex((w) => w.priority < priority);
        waiting.splice(before < 0 ? waiting.length : before, 0, { priority, start });
      });
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next.start();
      else active--;
    }
  };
}
