import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "./db/connect.js";
import { createApp } from "./app.js";
import { startScheduler } from "./services/sync.js";
import { initializeServer } from "./services/bootstrap.js";
import {startMentionMonitor} from './services/mentions.js';
let startupStage = "database";
try {
  await connectDatabase();
  startupStage = "bootstrap";
  await initializeServer();
  startupStage = "http";
  const server = createApp().listen(
    Number(process.env.PORT || 3000),
    "0.0.0.0",
    () =>
      console.log(
        JSON.stringify({
          event: "listening",
          port: Number(process.env.PORT || 3000),
        })
      )
  );
  const stop = startScheduler();
  const stopMentions=startMentionMonitor();
  const shutdown = () => {
    stop();
    stopMentions();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (e) {
  const safeMessages = new Set([
    "ADMIN_PASSWORD must have at least 8 characters",
    "Private bootstrap credentials do not match ADMIN_EMAIL",
    "MONGODB_URI is missing. Copy .env.example to .env and configure MongoDB.",
  ]);
  console.error(
    JSON.stringify({
      event: "startup_failed",
      stage: startupStage,
      message: safeMessages.has(e.message)
        ? e.message
        : startupStage === "database"
        ? "Database connection failed. Check MONGODB_URI and database access."
        : "Server startup failed. Check bootstrap configuration and writable storage.",
    })
  );
  // A failed bootstrap must not leave an open database connection keeping the
  // process alive while deployment tools wait for an HTTP listener.
  await mongoose.disconnect();
  process.exitCode = 1;
}
