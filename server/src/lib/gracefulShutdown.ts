/**
 * The order a graceful shutdown must run in (index.ts wires the real steps):
 * stop taking work, let in-flight work finish for a bounded time, hand back
 * whatever is still running, then close. Every later step runs even if an
 * earlier one throws -- above all the requeue, which is what keeps a lead
 * from being stranded IN_PROGRESS when the process exits.
 */
export interface ShutdownSteps {
  stopJobs: () => void;
  drain: () => Promise<void>;
  requeue: () => Promise<number>;
  close: () => Promise<void>;
  log?: (msg: string) => void;
}

export async function runShutdown(steps: ShutdownSteps): Promise<void> {
  const log = steps.log ?? ((msg: string) => console.log(msg));
  const attempt = async (name: string, step: () => unknown) => {
    try {
      return await step();
    } catch (err) {
      log(`[shutdown] ${name} failed: ${(err as Error)?.message ?? err}`);
      return undefined;
    }
  };
  await attempt("stopping jobs", steps.stopJobs);
  await attempt("draining", steps.drain);
  const requeued = await attempt("requeueing", steps.requeue);
  if (typeof requeued === "number" && requeued > 0) log(`[shutdown] returned ${requeued} in-flight lead(s) to the queue`);
  await attempt("closing", steps.close);
}
