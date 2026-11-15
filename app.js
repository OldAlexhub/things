import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";
const directory = path.dirname(fileURLToPath(import.meta.url));
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "https:", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    })
  );
  const allowed = (
    process.env.CORS_ORIGINS ||
    process.env.PUBLIC_URL ||
    "http://localhost:3000"
  ).split(",");
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
      credentials: true,
    })
  );
  app.use((req, res, next) => {
    if (
      req.headers.origin &&
      !allowed.includes(req.headers.origin) &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    )
      return res.status(403).json({ error: { message: "Origin not allowed" } });
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    const begin = Date.now();
    res.on("finish", () => {
      if (process.env.NODE_ENV !== "test")
        console.log(
          JSON.stringify({
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Date.now() - begin,
          })
        );
    });
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    })
  );
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1", publicRouter);
  app.use(
    "/uploads",
    express.static(path.resolve(process.env.UPLOAD_DIR || "uploads"), {
      maxAge: "7d",
      dotfiles: "deny",
    })
  );
  app.use(
    "/vendor",
    express.static(path.join(directory, "node_modules/leaflet/dist"), {
      maxAge: "30d",
    })
  );
  app.use(express.static(path.join(directory, "public"), { dotfiles: "deny" }));
  app.use((_req, res) =>
    res.status(404).json({ error: { message: "Not found" } })
  );
  app.use((err, req, res, _next) => {
    const validation =
      err.name === "ZodError" ||
      err.name === "ValidationError" ||
      err.name === "StrictModeError" ||
      err.name === "CastError";
    const status =
      err.code === 11000
        ? 409
        : validation
        ? 400
        : err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
    const message =
      err.code === 11000
        ? "A record with this identifier already exists"
        : validation
        ? "Check the submitted fields"
        : status < 500
        ? err.message
        : "The request could not be completed. Please try again.";
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          requestId: req.requestId,
          name: err.name,
        })
      );
    res
      .status(status)
      .json({
        error: {
          message,
          ...(err.issues
            ? {
                fields: err.issues.map((v) => ({
                  path: v.path.join("."),
                  message: v.message,
                })),
              }
            : {}),
          requestId: req.requestId,
        },
      });
  });
  return app;
}
