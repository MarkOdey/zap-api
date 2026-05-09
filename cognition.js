function Cognition() {
  const tasks = [];

  this.register = function (name, fn, intervalMs) {
    tasks.push({ name, fn, intervalMs, timerId: null });
  };

  this.start = function () {
    for (const task of tasks) {
      const run = async () => {
        try {
          await task.fn();
        } catch (err) {
          console.warn(`cognition [${task.name}] error:`, err.message);
        }
      };

      run();
      task.timerId = setInterval(run, task.intervalMs);
      console.log(`cognition [${task.name}] started, interval ${task.intervalMs}ms`);
    }
  };

  this.stop = function () {
    for (const task of tasks) {
      if (task.timerId !== null) {
        clearInterval(task.timerId);
        task.timerId = null;
        console.log(`cognition [${task.name}] stopped`);
      }
    }
  };
}

module.exports = Cognition;
