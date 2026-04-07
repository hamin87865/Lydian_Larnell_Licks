import "dotenv/config";

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

const app = express();
const httpServer = createServer(app);

function maskDatabaseUrl(connectionString?: string) {
  if (!connectionString) return "not-configured";

  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname || "unknown";
    const maskedHost = host.length <= 4 ? `${host.slice(0, 1)}***` : `${host.slice(0, 2)}***${host.slice(-2)}`;
    return `${parsed.protocol}//${maskedHost}:${parsed.port || "5432"}/${parsed.pathname.replace(/^\//, "")}`;
  } catch {
    return "invalid-database-url";
  }
}

function getAllowedOrigins() {
  const baseOrigins = process.env.NODE_ENV === "production"
    ? [
        process.env.CLIENT_URL,
        process.env.CLIENT_URL_WWW,
        process.env.RENDER_EXTERNAL_URL,
      ]
    : [
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ];

  return baseOrigins.filter((origin): origin is string => Boolean(origin));
}

console.info(`[boot] NODE_ENV=${process.env.NODE_ENV || "development"}`);
console.info(`[boot] DATABASE_URL=${maskDatabaseUrl(process.env.DATABASE_URL)}`);

if (process.env.NODE_ENV === "production") {
  app.use(
    helmet({
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://www.youtube.com/iframe_api", "https://s.ytimg.com"],
          frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
          imgSrc: ["'self'", "data:", "blob:", "https://i.ytimg.com", "https://www.youtube.com"],
          mediaSrc: ["'self'", "blob:", "https://www.youtube.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
          connectSrc: ["'self'", "https://www.youtube.com"],
        },
      },
    }),
  );
} else {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
}

const allowedOrigins = getAllowedOrigins();

function isAllowedOrigin(origin?: string | null) {
  if (!origin) return true;

  const normalized = origin.replace(/\/$/, "");

  // 기존 허용 목록
  if (allowedOrigins.includes(normalized)) {
    return true;
  }

  // 🔥 개발환경 확장 허용 (Render, Cloudflare 포함)
  if (process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(normalized);

      if (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
        url.hostname.endsWith(".onrender.com") || // 🔥 Render
        url.hostname.endsWith(".trycloudflare.com") // 🔥 Cloudflare
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      console.error("[CORS BLOCKED]", origin);
      callback(new Error("허용되지 않은 CORS origin 입니다."));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const isSecure = req.secure || forwardedProto === "https";

    if (isSecure) {
      next();
      return;
    }

    if (!req.headers.host) {
      next();
      return;
    }

    res.redirect(`https://${req.headers.host}${req.url}`);
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
});

const emailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "메일 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
});

declare module "http" {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/password-reset", authLimiter);
app.use("/api/auth/email", emailLimiter);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

const uploadsRoot = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

const publicStaticOptions = {
  fallthrough: false,
  maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
  immutable: process.env.NODE_ENV === "production",
};

app.use("/uploads/thumbnails", express.static(path.join(uploadsRoot, "thumbnails"), publicStaticOptions));
app.use("/uploads/profile-images", express.static(path.join(uploadsRoot, "profile-images"), publicStaticOptions));
app.use("/uploads/videos", express.static(path.join(uploadsRoot, "videos"), {
  ...publicStaticOptions,
  immutable: false,
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
}));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const pathName = req.path;
  let capturedJsonResponse: unknown;

  const originalResJson = res.json.bind(res);
  res.json = function patchedJson(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson, ...args);
  };

  res.on("finish", () => {
    if (!pathName.startsWith("/api")) {
      return;
    }

    const duration = Date.now() - start;
    const bodySuffix = res.statusCode >= 400 && capturedJsonResponse ? ` :: ${JSON.stringify(capturedJsonResponse)}` : "";
    log(`${req.method} ${pathName} ${res.statusCode} in ${duration}ms${bodySuffix}`);
  });

  next();
});

async function bootstrap() {
  try {
    await registerRoutes(httpServer, app);

    app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: unknown }).status) || 500 : 500;
      const message = err instanceof Error ? err.message : "Internal Server Error";

      console.error("[server] request error", err);

      if (res.headersSent) {
        next(err);
        return;
      }

      res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(port, () => {
      log(`serving on port ${port}`, "boot");
    });
  } catch (error) {
    console.error("[boot] 서버 시작 실패", error);
    process.exit(1);
  }
}

void bootstrap();
