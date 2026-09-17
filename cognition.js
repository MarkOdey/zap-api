/**
 * Background task scheduler.
 *
 * Tasks are rescheduled *after* each run settles rather than on a fixed interval.
 * setInterval would fire regardless of whether the previous run had finished, so a
 * task slower than its interval (explore over a large library, or a 20s inference
 * job) would pile up overlapping runs.
 */
function Cognition() {
  const tasks = [];
  let started = false;

  this.register = function (name, fn, intervalMs) {
    tasks.push({
      name,
      fn,
      intervalMs,
      timerId: null,
      running: false,
      runs: 0,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
      nextRunAt: null,
    });
  };

  this.start = function () {
    if (started) return;
    started = true;

    for (const task of tasks) {
      const loop = async () => {
        task.running = true;
        task.nextRunAt = null;
        const startedAt = Date.now();

        try {
          await task.fn();
          task.lastError = null;
        } catch (err) {
          task.lastError = err.message;
          console.warn(`cognition [${task.name}] error:`, err.message);
        }

        task.running = false;
        task.runs++;
        task.lastRunAt = startedAt;
        task.lastDurationMs = Date.now() - startedAt;

        if (started) {
          task.nextRunAt = Date.now() + task.intervalMs;
          task.timerId = setTimeout(loop, task.intervalMs);
        }
      };

      loop();
      console.log(`cognition [${task.name}] started, interval ${task.intervalMs}ms`);
    }
  };

  this.stop = function () {
    started = false;
    for (const task of tasks) {
      if (task.timerId !== null) {
        clearTimeout(task.timerId);
        task.timerId = null;
        console.log(`cognition [${task.name}] stopped`);
      }
      task.nextRunAt = null;
    }
  };

  /** Live view of the scheduler, for the client's status panel. */
  this.status = function () {
    return tasks.map(t => ({
      name: t.name,
      intervalMs: t.intervalMs,
      running: t.running,
      runs: t.runs,
      lastRunAt: t.lastRunAt,
      lastDurationMs: t.lastDurationMs,
      lastError: t.lastError,
      nextRunAt: t.nextRunAt,
    }));
  };
}

export default Cognition;
