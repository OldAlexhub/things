import "dotenv/config";
import { connectDatabase } from "./db/connect.js";
import { createApp } from "./app.js";
import { startScheduler } from "./services/sync.js";
try {
  await connectDatabase();
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
  const shutdown = () => {
    stop();
    server.close(async () => {
      const mongoose = (await import("mongoose")).default;
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (e) {
  console.error(
    e.message.includes("MONGODB_URI")
      ? e.message
      : "Server startup failed. Check MongoDB connectivity and environment configuration."
  );
  process.exitCode = 1;
}
