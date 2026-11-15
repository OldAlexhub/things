import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdminUser } from "../models/index.js";
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
  if (password.length < 14)
    throw new Error("ADMIN_PASSWORD must have at least 14 characters");
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
  if ((process.env.AUTO_SEED ?? "true") === "true") await seed();
}
