import http from "node:http";
import express from "express";
import { Server } from "socket.io";

import appreciate from "./action/appreciate.js";
import { ACTIONS, COMMANDS, describe } from "./action/registry.js";
import queue from "./utils/queue.js";
import { mountMedia } from "./utils/mediaRoute.js";

const PORT = process.env.PORT || 3000;

// One HTTP server shared by express and Socket.IO. Previously the Server bound
// its own port and the express app was never attached, so it served nothing.
const app = express();
mountMedia(app);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
  // Still needed: uploads arrive as base64 over the socket. Playback no longer
  // does — it goes over HTTP via /media/:key.
  maxHttpBufferSize: 500 * 1024 * 1024,
});

server.listen(PORT, () => {
  console.log("http + socket.io listening on port", PORT);
});

let cognition = null;

/** index.js hands the scheduler over so its status can be broadcast. */
Session.attachCognition = function (instance) {
  cognition = instance;
};

const status = () => ({ ...queue.snapshot(), tasks: cognition?.status() ?? [] });

// One listener for the whole process: every job transition reaches every client.
queue.on("change", (job) => {
  io.emit("queue:update", { job, pending: queue.length, tasks: cognition?.status() ?? [] });
});

// Push scheduler state on a slow heartbeat so countdowns stay honest even when
// no job is moving.
setInterval(() => {
  if (cognition) io.emit("queue:tasks", cognition.status());
}, 2000).unref();

io.on("connection", function (socket) {
  console.log("user connected:", socket.id);
  socket.emit("connected");

  socket.emit("queue:state", status());
  socket.emit("commands", describe());

  const session = new Session(socket);
  session.update();

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    session.destroy();
  });
});

function Session(socket) {
  const self = this;

  this.socket = socket;
  this.actions = Session.actions.slice();

  let destroyed = false;
  let paused = false;

  this.update = async function () {
    if (destroyed || paused) return;

    // Pick a random action from the stack
    let actionFn;
    for (const fn of self.actions) {
      if (Math.floor(Math.random() * 2) === 0) actionFn = fn;
    }

    if (!actionFn) {
      setTimeout(() => self.update(), 1000);
      return;
    }

    try {
      await actionFn(self);
    } catch (err) {
      console.error("action error:", err.message);
    }

    if (!destroyed && !paused) {
      setTimeout(() => self.update(), 100);
    }
  };

  socket.on("current", () => socket.emit("current", { key: self.currentKey ?? null }));

  socket.on("pause", () => {
    console.log("session paused:", socket.id);
    paused = true;
  });

  socket.on("play", () => {
    console.log("session resumed:", socket.id);
    paused = false;
    self.update();
  });

  // Kept for older clients: explore is just another queued job now.
  socket.on("explore", () => {
    console.log("explore queued by:", socket.id);
    queue.push("explore");
  });

  socket.on("queue:push", (data, ack) => {
    let action, params;
    try {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      action = parsed?.action;
      params = parsed?.params ?? {};
    } catch {
      action = null;
    }

    const spec = ACTIONS[action];
    if (!spec) {
      const error = `unknown action: ${action}`;
      console.warn("queue:push", error);
      if (typeof ack === "function") ack({ ok: false, error });
      return;
    }

    const job = queue.push(action, params);
    console.log(`queue: ${action} pushed by ${socket.id} (${job.id})`);
    if (typeof ack === "function") ack({ ok: true, id: job.id });
  });

  socket.on("queue:cancel", ({ id } = {}) => {
    const job = queue.cancel(id);
    console.log(job ? `queue: cancelled ${id}` : `queue: cannot cancel ${id}`);
  });

  socket.on("queue:state", () => socket.emit("queue:state", status()));

  socket.on("list", async (params, ack) => {
    try {
      const page = await COMMANDS.list(params ?? {});
      const payload = { ...page, currentKey: self.currentKey ?? null };
      if (typeof ack === "function") ack(payload);
      else socket.emit("listed", payload);
    } catch (err) {
      console.error("list error:", err.message);
      if (typeof ack === "function") ack({ error: err.message });
      else socket.emit("listed", { error: err.message });
    }
  });

  // Force the next item. The loop is parked awaiting resolve/reject inside
  // play(), so ending that wait is what lets the new key take effect — the
  // client emits reject straight after. Resuming from paused is handled here so
  // a click works whether or not the loop is running.
  socket.on("playKey", ({ key } = {}) => {
    if (!key) return;
    self.forcedKey = key;
    console.log("play: queued forced key", key);
    if (paused) {
      paused = false;
      self.update();
    }
  });

  socket.on("run", async function (data) {
    let actionName, params;
    try {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      actionName = parsed.action || parsed;
      params = parsed.params;
    } catch {
      actionName = String(data);
    }

    const spec = ACTIONS[actionName];
    if (!spec) {
      console.warn("unknown command:", actionName);
      socket.emit("run:error", { action: actionName, error: `unknown command: ${actionName}` });
      return;
    }

    // Slow actions go through the queue so the client can watch them; quick ones
    // run inline and answer immediately.
    if (spec.queueable) {
      const job = queue.push(actionName, params ?? {});
      socket.emit("run:queued", { action: actionName, id: job.id });
      return;
    }

    try {
      const result = await spec.fn(params !== undefined ? params : self);
      socket.emit("run:done", { action: actionName, result: result ?? null });
      console.log("terminal command resolved:", actionName);
    } catch (err) {
      console.error("terminal command error:", actionName, err.message);
      socket.emit("run:error", { action: actionName, error: err.message });
    }
  });

  // `self`, not `session`: Session is a module-level function, so the `session`
  // const inside the connection callback is not in its scope chain. Referencing
  // it threw ReferenceError on every click, so no appreciation ever landed.
  const appreciateCurrent = async (delta, label) => {
    if (!self.currentKey) {
      console.warn(`${label}: nothing is playing`);
      return;
    }
    try {
      await appreciate({
        key: self.currentKey,
        edgeKey: self.precedingEdge?.key,
        delta,
      });
    } catch (err) {
      console.error(`${label} error:`, err.message);
    }
  };

  socket.on("like", () => appreciateCurrent(+0.1, "like"));
  socket.on("dislike", () => appreciateCurrent(-0.1, "dislike"));

  // Acks as well as emitting, so a client uploading several files can await each
  // one. `upload:done` alone carries no correlation, so two in flight would be
  // indistinguishable.
  socket.on("upload", async function (data, ack) {
    const name = typeof data === "object" ? data?.meta?.name : undefined;
    let outcome;
    try {
      const result = await COMMANDS.upload(data);
      outcome = { ok: true, name, segments: result.segments };
    } catch (err) {
      console.error("upload error:", name ?? "(unnamed)", err.message);
      outcome = { ok: false, name, error: err.message };
    }
    socket.emit("upload:done", outcome);
    if (typeof ack === "function") ack(outcome);
  });

  Session.sessions.push(this);

  this.destroy = function () {
    const index = Session.sessions.indexOf(self);
    if (index !== -1) Session.sessions.splice(index, 1);
    destroyed = true;
  };
}

Session.actions = [];
Session.sessions = [];

Session.addAction = function (actionFn) {
  Session.actions.push(actionFn);
};

export default Session;
