import mongoose from "mongoose";
import {importReviewed} from "../scripts/quality-editorial.js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdminUser, City } from "../models/index.js";
import { triggerSync } from './sync.js';
import { hashPassword } from "../lib/auth.js";
import { seed } from "../scripts/seed.js";

export async function ensureAdministrator(directory = ".secrets") {
  if (
    (process.env.AUTO_CREATE_ADMIN ?? "true") !== "true" ||
    (await AdminUser.exists({}))
  )
    return { created: false };
  await AdminUser.init();
  const email = (
    process.env.ADMIN_EMAIL || "info@oldalexhub.com"
  ).toLowerCase();
  let password = process.env.ADMIN_PASSWORD,
    credentialsFile;
  if (!password) {
    const folder = path.resolve(directory);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    credentialsFile = path.join(folder, "initial-admin.json");
    try {
      await writeFile(
        credentialsFile,
        JSON.stringify(
          { email, password: randomBytes(32).toString("base64url") },
          null,
          2
        ) + "\n",
        { flag: "wx", mode: 0o600 }
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const saved = JSON.parse(await readFile(credentialsFile, "utf8"));
    if (saved.email !== email || typeof saved.password !== "string")
      throw new Error("Private bootstrap credentials do not match ADMIN_EMAIL");
    password = saved.password;
  }
  if (password.length < 8)
    throw new Error("ADMIN_PASSWORD must have at least 8 characters");
  try {
    await AdminUser.create({
      email,
      passwordHash: await hashPassword(password),
      role: "admin",
      active: true,
    });
  } catch (error) {
    if (error.code === 11000) return { created: false };
    throw error;
  }
  return { created: true, credentialsFile };
}
export async function initializeServer() {
  const admin = await ensureAdministrator();
  if (admin.created)
    console.log(
      JSON.stringify({
        event: "administrator_initialized",
        ...(admin.credentialsFile
          ? { credentialsFile: admin.credentialsFile }
          : { passwordSource: "environment" }),
      })
    );
  if ((process.env.AUTO_SEED ?? "true") === "true") {
    await seed();
    const migrations=mongoose.connection.collection('contentMigrations');
    const key='orlando-reviewed-2026-11-15';
    if(!await migrations.findOne({_id:key})) {
      await importReviewed();
      try {await migrations.insertOne({_id:key,appliedAt:new Date()});}catch(error){if(error.code!==11000)throw error;}
    }
    await queuePhotoUpgrade();
  }
}

// Existing catalogs otherwise wait until their weekly import for new photos.
// Queue once, without blocking startup on external providers or changing settings.
export async function queuePhotoUpgrade() {
  if ((process.env.SYNC_ENABLED ?? 'true') !== 'true') return;
  const migrations=mongoose.connection.collection('contentMigrations');
  const key='venue-photography-v2-2026-11-15';
  if(await migrations.findOne({_id:key})) return;
  for(const city of await City.find({publicationStatus:'published'}).select('_id').lean()) {
    try { await triggerSync('osm',String(city._id)); }
    catch(error) { if(error.status!==422) throw error; }
  }
  try { await migrations.insertOne({_id:key,appliedAt:new Date()}); }
  catch(error) { if(error.code!==11000) throw error; }
}
