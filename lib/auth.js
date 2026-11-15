import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { AdminSession, AdminUser } from "../models/index.js";
const scrypt = promisify(scryptCallback);
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, hash) {
  if (!hash) {
    await scrypt(password, "nonexistent-user-timing-salt", 64);
    return false;
  }
  const [salt, key] = hash.split(":");
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function cookieToken(req) {
  return (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("ttd_session="))
    ?.slice(12);
}
export async function requireAdmin(req, res, next) {
  try {
    const token = cookieToken(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      return res
        .status(401)
        .json({ error: { message: "Sign in to continue" } });
    const session = await AdminSession.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    }).lean();
    const user =
      session &&
      (await AdminUser.findOne({ _id: session.userId, active: true }).lean());
    if (!user)
      return res
        .status(401)
        .json({ error: { message: "Session expired. Sign in again." } });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== session.csrf
    )
      return res.status(403).json({ error: { message: "Invalid CSRF token" } });
    req.admin = user;
    req.adminSession = session;
    next();
  } catch (e) {
    next(e);
  }
}
export function adminOnly(req, res, next) {
  if (req.admin.role !== "admin")
    return res
      .status(403)
      .json({ error: { message: "Administrator access required" } });
  next();
}
export async function createSession(user, res) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  await AdminSession.create({
    tokenHash: hashToken(token),
    userId: user._id,
    csrf,
    expiresAt: new Date(Date.now() + 8 * 3600000),
  });
  res.cookie("ttd_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 3600000,
    path: "/api/v1/admin",
  });
  return { email: user.email, role: user.role, csrf };
}
