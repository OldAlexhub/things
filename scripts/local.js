import "dotenv/config";
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { connectDatabase } from "../db/connect.js";
import { seed } from "./seed.js";
import { createApp } from "../app.js";
import { startScheduler } from "../services/sync.js";
import { ContentSource } from "../models/index.js";
import { triggerSync } from "../services/sync.js";
await mkdir(".local/db", { recursive: true });
if (!process.env.ADMIN_PASSWORD) {
  try {
    process.env.ADMIN_PASSWORD = JSON.parse(
      await readFile(".local/admin-login.json", "utf8")
    ).password;
  } catch {
    process.env.ADMIN_PASSWORD = randomBytes(24).toString("base64url");
    await writeFile(
      ".local/admin-login.json",
      JSON.stringify(
        { email: "info@oldalexhub.com", password: process.env.ADMIN_PASSWORD },
        null,
        2
      ),
      { mode: 0o600 }
    );
  }
}
const mongo = await MongoMemoryServer.create({
  instance: {
    dbPath: path.resolve(".local/db"),
    dbName: "thingstodo",
    storageEngine: "wiredTiger",
  },
});
await writeFile(
  ".local/connection.json",
  JSON.stringify({ uri: mongo.getUri("thingstodo") })
);
await connectDatabase(mongo.getUri("thingstodo"));
const city = await seed();
if (process.argv.includes("--import-osm")) {
  process.env.OSM_ENABLED = "true";
  await ContentSource.updateOne(
    { name: "osm" },
    { $set: { enabled: true, permissionReviewed: true } }
  );
  await triggerSync("osm", String(city._id));
  console.log(
    "Importing OpenStreetMap under ODbL with contributor attribution. Review source data before release."
  );
}
const server = createApp().listen(
  Number(process.env.PORT || 3000),
  "127.0.0.1",
  () =>
    console.log(
      "Local development server: http://localhost:3000. Database persists in server/.local/db."
    )
);
const stop = startScheduler();
console.log(
  "Local-only administrator credentials are stored privately in server/.local/admin-login.json."
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    server.close(async () => {
      await mongo.stop({ doCleanup: false, force: false });
      process.exit(0);
    });
  });
