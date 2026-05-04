const express = require("express");
const app = express();
app.use(express.static("../"));

const io = require("socket.io")(process.env.PORT || 3000, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

console.log("socket.io listening on port", process.env.PORT || 3000);

// Named command dispatcher — replaces eval()
const COMMANDS = {
  explore: require("./action/explore.js"),
  find: require("./action/find.js"),
  removeAll: require("./action/removeAll.js"),
  normalize: require("./action/normalize.js"),
  crop: require("./action/crop.js"),
  concat: require("./action/concat.js"),
  upload: require("./action/upload.js"),
};

io.on("connection", function (socket) {
  console.log("user connected:", socket.id);
  socket.emit("connected");

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
      setTimeout(() => self.update(), 2000);
    }
  };

  socket.on("pause", () => {
    console.log("session paused:", socket.id);
    paused = true;
  });

  socket.on("play", () => {
    console.log("session resumed:", socket.id);
    paused = false;
    self.update();
  });

  socket.on("explore", async () => {
    console.log("explore triggered by:", socket.id);
    try {
      await COMMANDS.explore();
      socket.emit("explored");
      console.log("explore complete");
    } catch (err) {
      console.error("explore error:", err.message);
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

    const actionFn = COMMANDS[actionName];
    if (!actionFn) {
      console.warn("unknown command:", actionName);
      return;
    }

    try {
      await actionFn(params !== undefined ? params : self);
      console.log("terminal command resolved:", actionName);
    } catch (err) {
      console.error("terminal command error:", actionName, err.message);
    }
  });

  socket.on("upload", async function (data) {
    try {
      await COMMANDS.upload(data);
    } catch (err) {
      console.error("upload error:", err.message);
    }
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

module.exports = Session;
