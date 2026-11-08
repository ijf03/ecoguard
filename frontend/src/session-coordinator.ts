/** Keep an in-flight refresh from setting a session cookie after logout. */
export function createSessionCoordinator<T>() {
  let pending: Promise<T | undefined> = Promise.resolve(undefined);
  let ending = false;
  return {
    run(work: () => Promise<T>) {
      pending = pending.catch(() => undefined).then(() => ending ? undefined : work());
      return pending;
    },
    resume() { ending = false; },
    async end(clear: () => Promise<void>) {
      ending = true;
      await pending.catch(() => undefined);
      try { await clear(); }
      catch (error) { ending = false; throw error; }
    },
  };
}
