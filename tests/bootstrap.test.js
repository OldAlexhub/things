import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ensureAdministrator } from "../services/bootstrap.js";
import { AdminUser } from "../models/index.js";
import { verifyPassword } from "../lib/auth.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const execFileAsync = promisify(execFile);
const serverEntry = fileURLToPath(new URL("../server.js", import.meta.url));
let mongo, directory;
before(async () => {
  process.env.NODE_ENV = "test";
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  directory = await mkdtemp(path.join(os.tmpdir(), "ttd-bootstrap-test-"));
});
beforeEach(async () => {
  await AdminUser.deleteMany({});
  delete process.env.ADMIN_PASSWORD;
  process.env.ADMIN_EMAIL = "info@oldalexhub.com";
  process.env.AUTO_CREATE_ADMIN = "true";
});
after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  if (directory.startsWith(path.join(os.tmpdir(), "ttd-bootstrap-test-")))
    await rm(directory, { recursive: true, force: true });
});
test("first startup creates a strong private login and restarts preserve the administrator", async () => {
  const first = await ensureAdministrator(directory);
  assert.equal(first.created, true);
  const secret = JSON.parse(await readFile(first.credentialsFile, "utf8"));
  assert.ok(secret.password.length >= 40);
  const user = await AdminUser.findOne({}).select("+passwordHash");
  assert.ok(await verifyPassword(secret.password, user.passwordHash));
  process.env.ADMIN_PASSWORD = "changed-environment-password";
  assert.equal((await ensureAdministrator(directory)).created, false);
  const retained = await AdminUser.findById(user._id).select("+passwordHash");
  assert.equal(retained.passwordHash, user.passwordHash);
});
test("automatic administrator creation can be explicitly disabled", async () => {
  process.env.AUTO_CREATE_ADMIN = "false";
  assert.equal((await ensureAdministrator(directory)).created, false);
  assert.equal(await AdminUser.countDocuments(), 0);
});

test("first startup accepts the configured ten-character password without replacing it", async () => {
  process.env.ADMIN_PASSWORD = "custompass";
  const first = await ensureAdministrator(directory);
  assert.equal(first.created, true);
  assert.equal(first.credentialsFile, undefined);
  const user = await AdminUser.findOne({}).select("+passwordHash");
  assert.ok(await verifyPassword(process.env.ADMIN_PASSWORD, user.passwordHash));
  assert.equal((await ensureAdministrator(directory)).created, false);
});

test("invalid bootstrap password exits promptly with an actionable error and no secret", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [serverEntry], {
      cwd: directory,
      timeout: 10000,
      env: {
        ...process.env,
        MONGODB_URI: mongo.getUri(),
        ADMIN_PASSWORD: "tiny!",
        AUTO_CREATE_ADMIN: "true",
        AUTO_SEED: "false",
      },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.killed, false);
      assert.match(error.stderr, /ADMIN_PASSWORD must have at least 8 characters/);
      assert.match(error.stderr, /"stage":"bootstrap"/);
      assert.ok(!error.stderr.includes("tiny!"));
      return true;
    }
  );
  assert.equal(await AdminUser.countDocuments(), 0);
});

test("database startup errors do not expose connection credentials", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [serverEntry], {
      cwd: directory,
      timeout: 10000,
      env: {
        ...process.env,
        MONGODB_URI: "mongodb://sample:private-sentinel@%invalid/database",
      },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.killed, false);
      assert.match(error.stderr, /"stage":"database"/);
      assert.ok(!error.stderr.includes("private-sentinel"));
      return true;
    }
  );
});
