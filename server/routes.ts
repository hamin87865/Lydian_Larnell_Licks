import type { Express, Request, Response } from "express";
import session from "express-session";
import { type Server } from "http";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { ensureDatabase, pool, createSessionStore } from "./db";
import multer from "multer";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "basic" | "musician" | "admin";
  upgradeRequestStatus: "none" | "pending" | "approved" | "rejected";
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  if (passwordHash.startsWith("plain:")) {
    return passwordHash.slice(6) === password;
  }

  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) return false;

  const computedHash = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (computedHash.length !== storedBuffer.length) return false;

  return timingSafeEqual(computedHash, storedBuffer);
}

function mapUser(row: any): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    upgradeRequestStatus: row.upgrade_request_status,
  };
}

function requireAuth(req: Request, res: Response): SessionUser | null {
  if (!req.session.user) {
    res.status(401).json({ message: "로그인이 필요합니다." });
    return null;
  }
  return req.session.user;
}

function requireAdmin(req: Request, res: Response): SessionUser | null {
  const user = requireAuth(req, res);
  if (!user) return null;

  if (user.role !== "admin") {
    res.status(403).json({ message: "관리자 권한이 필요합니다." });
    return null;
  }

  return user;
}

const uploadsRoot = path.join(process.cwd(), "uploads");
const videosDir = path.join(uploadsRoot, "videos");
const pdfsDir = path.join(uploadsRoot, "pdfs");
const thumbnailsDir = path.join(uploadsRoot, "thumbnails");
const contractsDir = path.join(uploadsRoot, "contracts");
const profileImagesDir = path.join(uploadsRoot, "profile-images");

for (const dir of [uploadsRoot, videosDir, pdfsDir, contractsDir, thumbnailsDir, profileImagesDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}


function safeUnlink(filePath?: string | null) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("파일 정리 실패:", error);
  }
}

function getFileExtension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

function validateFileSignature(file: Express.Multer.File, type: "image" | "video" | "pdf") {
  const header = fs.readFileSync(file.path).subarray(0, 32);
  const ext = getFileExtension(file.originalname);

  if (type === "pdf") {
    const isPdf = header.subarray(0, 4).toString() === "%PDF";
    if (!isPdf || ext !== ".pdf" || file.mimetype !== "application/pdf") {
      throw new Error("PDF 파일 검증에 실패했습니다.");
    }
    return;
  }

  if (type === "image") {
    const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isGif = header.subarray(0, 3).toString() === "GIF";
    const isWebp = header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP";
    const allowedExt = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

    if (!(isPng || isJpeg || isGif || isWebp) || !allowedExt.includes(ext)) {
      throw new Error("이미지 파일 검증에 실패했습니다.");
    }
    return;
  }

  const isMp4 = header.subarray(4, 8).toString().includes("ftyp");
  const allowedVideoExt = [".mp4", ".mov", ".m4v", ".webm"];
  if (!allowedVideoExt.includes(ext) || !file.mimetype.startsWith("video/") || !isMp4) {
    throw new Error("영상 파일 검증에 실패했습니다. mp4 계열 파일만 업로드할 수 있습니다.");
  }
}

function assertOwnedFilePath(filePath: string, allowedDir: string) {
  const resolved = path.resolve(filePath);
  const allowed = path.resolve(allowedDir);
  if (!resolved.startsWith(allowed)) {
    throw new Error("허용되지 않은 파일 경로입니다.");
  }
  return resolved;
}

function normalizeOptionalText(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function resolveNotificationsEnabled(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function canAccessPaidPdf(content: { pdf_price: number | string; author_id: string }, userId?: string | null, hasPurchased = false) {
  const price = Number(content.pdf_price || 0);
  if (price <= 0) return true;
  if (!userId) return false;
  if (content.author_id === userId) return true;
  return hasPurchased;
}

function createEphemeralToken(size = 24) {
  return randomBytes(size).toString("hex");
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "videoFile") {
      cb(null, videosDir);
      return;
    }

    if (file.fieldname === "pdfFile") {
      cb(null, pdfsDir);
      return;
    }

    if (file.fieldname === "signedContractFile") {
      cb(null, contractsDir);
      return;
    }

    if (file.fieldname === "thumbnail") {
      cb(null, thumbnailsDir);
      return;
    }

    if (file.fieldname === "profileImageFile") {
      cb(null, profileImagesDir);
      return;
    }

    cb(null, uploadsRoot);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${sanitizeFileName(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 300 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "videoFile") {
      if (file.mimetype.startsWith("video/")) {
        cb(null, true);
      } else {
        cb(new Error("영상 파일만 업로드 가능합니다."));
      }
      return;
    }

    if (file.fieldname === "pdfFile") {
      if (file.mimetype === "application/pdf") {
        cb(null, true);
      } else {
        cb(new Error("PDF 파일만 업로드 가능합니다."));
      }
      return;
    }

    if (file.fieldname === "signedContractFile") {
      if (file.mimetype === "application/pdf") {
        cb(null, true);
      } else {
        cb(new Error("서명한 계약서는 PDF 파일만 업로드 가능합니다."));
      }
      return;
    }

    if (file.fieldname === "thumbnail" || file.fieldname === "profileImageFile") {
      if (file.mimetype.startsWith("image/")) {
        cb(null, true);
      } else {
        cb(new Error("이미지 파일만 업로드 가능합니다."));
      }
      return;
    }

    cb(null, true);
  },
});

function normalizeEmail(email: string) {
  return String(email).trim().toLowerCase();
}

function filePathToPublicUrl(filePath: string) {
  return filePath.replace(process.cwd(), "").replace(/\\/g, "/");
}

function mapContent(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    thumbnail: row.thumbnail,
    videoUrl: row.video_url || "",
    videoFile: row.video_file || undefined,
    pdfFile: row.pdf_file || undefined,
    pdfFileName: row.pdf_file_name || undefined,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
    pdfPrice: Number(row.pdf_price || 0),
    isSanctioned: row.is_sanctioned,
    sanctionReason: row.sanction_reason || undefined,
    sanctionedAt: row.sanctioned_at || undefined,
  };
}

function mapUserSettings(row: any) {
  return {
    nickname: row.nickname || undefined,
    profileImage: row.profile_image || undefined,
    bio: row.bio || undefined,
    email: row.email || undefined,
    instagram: row.instagram || undefined,
    layout: row.layout || "horizontal",
    language: row.language || "ko",
    notificationsEnabled: row.notifications_enabled,
    lastNicknameChange: row.last_nickname_change ? Number(row.last_nickname_change) : null,
  };
}

function createEmailCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildVerificationEmailHtml(title: string, description: string, code: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
      <h2 style="margin-bottom: 12px;">${title}</h2>
      <p>${description}</p>
      <div style="margin: 20px 0; font-size: 28px; font-weight: 700; letter-spacing: 6px;">
        ${code}
      </div>
      <p>인증코드는 5분 동안 유효합니다.</p>
    </div>
  `;
}

async function sendNewContentNotificationEmail(content: { title: string; authorName: string; category: string; id: string }, uploaderId: string) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return;
  }

  const subscribersResult = await pool.query(
    `SELECT DISTINCT u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_settings us ON us.user_id = u.id
     WHERE s.target_id = $1
       AND s.notify = TRUE
       AND u.deleted_at IS NULL
       AND COALESCE(us.notifications_enabled, TRUE) = TRUE`,
    [uploaderId],
  );

  if (subscribersResult.rows.length === 0) {
    return;
  }

  await Promise.allSettled(
    subscribersResult.rows.map((row) =>
      transporter.sendMail({
        from: `"Lydian Larnell" <${process.env.EMAIL_USER}>`,
        to: row.email,
        subject: `[Lydian Larnell] ${content.authorName} 님의 새 영상 업로드 알림`,
        text: `${content.authorName} 님이 새 콘텐츠를 업로드했습니다.
제목: ${content.title}
카테고리: ${content.category}
확인 경로: /content/${content.id}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
            <h2 style="margin-bottom: 12px;">새 영상 업로드 알림</h2>
            <p><strong>${content.authorName}</strong> 님이 새 콘텐츠를 업로드했습니다.</p>
            <p>제목: <strong>${content.title}</strong></p>
            <p>카테고리: ${content.category}</p>
            <p>사이트에서 확인해 주세요.</p>
          </div>
        `,
      }),
    ),
  );
}

const emailCodes = new Map<string, { code: string; expires: number }>();

const passwordResetCodes = new Map<string, { code: string; expires: number; verified: boolean; verifiedToken?: string }>();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function buildBootstrapData(currentUserId?: string) {
  const usersResult = await pool.query(`
    SELECT id, email, name, role, upgrade_request_status
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
  `);

  const settingsResult = await pool.query(`SELECT * FROM user_settings`);

  const contentsResult = await pool.query(`
    SELECT
      id,
      title,
      description,
      category,
      thumbnail,
      video_url,
      video_file,
      pdf_file,
      pdf_file_name,
      author_id,
      author_name,
      created_at,
      pdf_price,
      is_sanctioned,
      sanction_reason,
      sanctioned_at
    FROM contents
    ORDER BY created_at DESC
  `);

  const appsResult = await pool.query(`
    SELECT
      id,
      user_id,
      name,
      nickname,
      category,
      email,
      bank_name,
      account_number,
      account_holder,
      video_file_name,
      video_size,
      video_path,
      signed_contract_file_name,
      signed_contract_size,
      signed_contract_path,
      contract_checked,
      created_at,
      status
    FROM musician_applications
    ORDER BY created_at DESC
  `);

  const purchasesResult = currentUserId
    ? await pool.query(`SELECT content_id FROM purchases WHERE user_id = $1`, [currentUserId])
    : { rows: [] as any[] };

  const subsResult = currentUserId
    ? await pool.query(`SELECT target_id, notify FROM subscriptions WHERE user_id = $1`, [currentUserId])
    : { rows: [] as any[] };

  const users = usersResult.rows.map(mapUser);

  const userSettings = settingsResult.rows.reduce<Record<string, any>>((acc, row) => {
    acc[row.user_id] = {
      nickname: row.nickname || undefined,
      profileImage: row.profile_image || undefined,
      bio: row.bio || undefined,
      email: row.email || undefined,
      instagram: row.instagram || undefined,
      layout: row.layout || "horizontal",
      language: row.language || "ko",
      notificationsEnabled: row.notifications_enabled,
      lastNicknameChange: row.last_nickname_change ? Number(row.last_nickname_change) : null,
    };
    return acc;
  }, {});

  const contents = contentsResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    thumbnail: row.thumbnail,
    videoUrl: row.video_url || "",
    videoFile: row.video_file || undefined,
    pdfFile: row.pdf_file || undefined,
    pdfFileName: row.pdf_file_name || undefined,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
    pdfPrice: Number(row.pdf_price || 0),
    isSanctioned: row.is_sanctioned,
    sanctionReason: row.sanction_reason || undefined,
    sanctionedAt: row.sanctioned_at || undefined,
  }));

  const musicianApplications = appsResult.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nickname: row.nickname,
    category: row.category,
    email: row.email,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolder: row.account_holder,
    videoFileName: row.video_file_name,
    videoSize: row.video_size ? Number(row.video_size) : undefined,
    videoPath: row.video_path || undefined,
    signedContractFileName: row.signed_contract_file_name || undefined,
    signedContractSize: row.signed_contract_size ? Number(row.signed_contract_size) : undefined,
    signedContractPath: row.signed_contract_path || undefined,
    contractChecked: row.contract_checked,
    createdAt: row.created_at,
    status: row.status,
  }));

  const purchases = purchasesResult.rows.map((row) => ({
    userId: currentUserId,
    contentId: row.content_id,
  }));

  const subscriptions = subsResult.rows.map((row) => ({
    targetId: row.target_id,
    notify: row.notify,
  }));

  return { users, userSettings, contents, musicianApplications, purchases, subscriptions };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  await ensureDatabase();

  app.use(
    session({
      secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || "development-session-secret-change-me",
      resave: false,
      saveUninitialized: false,
      store: createSessionStore(),
      cookie: {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  app.get("/api/bootstrap", async (req, res) => {
    const data = await buildBootstrapData(req.session.user?.id);
    res.json(data);
  });

  app.get("/api/contents", async (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";

    const contentsResult = category
      ? await pool.query(
          `SELECT id, title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, created_at, pdf_price, is_sanctioned, sanction_reason, sanctioned_at
           FROM contents
           WHERE category = $1
           ORDER BY created_at DESC`,
          [category],
        )
      : await pool.query(
          `SELECT id, title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, created_at, pdf_price, is_sanctioned, sanction_reason, sanctioned_at
           FROM contents
           ORDER BY created_at DESC`,
        );

    const settingsResult = await pool.query(`SELECT user_id, nickname FROM user_settings WHERE nickname IS NOT NULL`);
    const authorNicknames = settingsResult.rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.user_id] = row.nickname;
      return acc;
    }, {});

    res.json({ contents: contentsResult.rows.map(mapContent), authorNicknames });
  });

  app.get("/api/contents/:id", async (req, res) => {
    const result = await pool.query(
      `SELECT id, title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, created_at, pdf_price, is_sanctioned, sanction_reason, sanctioned_at
       FROM contents
       WHERE id = $1`,
      [req.params.id],
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ content: null, hasPurchased: false });
    }

    let hasPurchased = false;
    if (req.session.user) {
      const purchaseResult = await pool.query(
        `SELECT 1 FROM purchases WHERE user_id = $1 AND content_id = $2 LIMIT 1`,
        [req.session.user.id, req.params.id],
      );
      hasPurchased = Boolean(purchaseResult.rows[0]);
    }

    res.json({ content: mapContent(row), hasPurchased });
  });

  app.get("/api/contents/:id/pdf-download", async (req, res) => {
    const result = await pool.query(
      `SELECT id, pdf_file, pdf_file_name, pdf_price, author_id, is_sanctioned FROM contents WHERE id = $1`,
      [req.params.id],
    );

    const content = result.rows[0];
    if (!content || !content.pdf_file) {
      return res.status(404).json({ message: "PDF 파일을 찾을 수 없습니다." });
    }

    if (content.is_sanctioned) {
      return res.status(403).json({ message: "제재된 콘텐츠는 다운로드할 수 없습니다." });
    }

    let hasPurchased = false;
    if (req.session.user?.id) {
      const purchaseResult = await pool.query(
        `SELECT 1 FROM purchases WHERE user_id = $1 AND content_id = $2 LIMIT 1`,
        [req.session.user.id, req.params.id],
      );
      hasPurchased = Boolean(purchaseResult.rows[0]);
    }

    if (!canAccessPaidPdf(content, req.session.user?.id, hasPurchased)) {
      return res.status(403).json({ message: "구매한 회원만 PDF를 다운로드할 수 있습니다." });
    }

    const absolutePath = assertOwnedFilePath(path.join(process.cwd(), content.pdf_file.replace(/^\//, "")), pdfsDir);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: "PDF 파일이 존재하지 않습니다." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(content.pdf_file_name || 'download.pdf')}`);
    return res.sendFile(absolutePath);
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ message: "로그인되지 않았습니다." });
    }

    const result = await pool.query(
      `SELECT id, email, name, role, upgrade_request_status FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [req.session.user.id],
    );

    if (!result.rows[0]) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "사용자를 찾을 수 없습니다." });
    }

    const user = mapUser(result.rows[0]);
    req.session.user = user;
    res.json({ user });
  });

  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name } = req.body ?? {};

    if (!email || !password || !name) {
      return res.status(400).json({ message: "이름, 이메일, 비밀번호를 모두 입력해 주세요." });
    }

    const normalizedEmail = normalizeEmail(email);

    if (String(password).length < 6) {
      return res.status(400).json({ message: "비밀번호는 최소 6자 이상이어야 합니다." });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail]
    );

    if (existing.rows[0]) {
      return res.status(409).json({ message: "이미 가입된 이메일입니다." });
    }

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, upgrade_request_status)
      VALUES ($1, $2, $3, 'basic', 'none')
      RETURNING id, email, name, role, upgrade_request_status`,
      [normalizedEmail, hashPassword(password), name],
    );

    const user = mapUser(result.rows[0]);
    req.session.user = user;
    res.json({ user });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ message: "이메일과 비밀번호를 입력해 주세요." });
    }

    const normalizedEmail = normalizeEmail(email);

    const result = await pool.query(
      `SELECT id, email, name, role, upgrade_request_status, password_hash
      FROM users
      WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail],
    );

    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 일치하지 않습니다." });
    }

    if (row.password_hash.startsWith("plain:")) {
      await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashPassword(password), row.id]);
    }

    const user = mapUser(row);
    req.session.user = user;
    res.json({ user });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.post("/api/auth/password-reset/send-code", async (req, res) => {
    const { email } = req.body ?? {};

    if (!email) {
      return res.status(400).json({ message: "이메일이 필요합니다." });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        message: "이메일 발송 환경변수가 설정되지 않았습니다. EMAIL_USER, EMAIL_PASS를 확인해 주세요.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: "올바른 이메일 형식이 아닙니다." });
    }

    const userResult = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail],
    );

    if (!userResult.rows[0]) {
      return res.status(404).json({ message: "회원가입되지 않은 이메일입니다." });
    }

    const code = createEmailCode();
    const expires = Date.now() + 1000 * 60 * 5;

    try {
      await transporter.sendMail({
        from: `"Lydian Larnell" <${process.env.EMAIL_USER}>`,
        to: normalizedEmail,
        subject: "Lydian Larnell 비밀번호 재설정 인증코드",
        text: `비밀번호 재설정 인증코드는 ${code} 입니다. 5분 이내에 입력해 주세요.`,
        html: buildVerificationEmailHtml("비밀번호 재설정 인증코드", "아래 6자리 인증코드를 입력해 주세요.", code),
      });

      passwordResetCodes.set(normalizedEmail, { code, expires, verified: false });

      return res.json({
        success: true,
        message: "인증코드가 발송되었습니다.",
      });
    } catch (error) {
      console.error("비밀번호 재설정 메일 발송 실패:", error);
      return res.status(500).json({ message: "메일 발송에 실패했습니다." });
    }
  });

  app.post("/api/auth/password-reset/verify-code", async (req, res) => {
    const { email, code } = req.body ?? {};

    if (!email || !code) {
      return res.status(400).json({
        verified: false,
        message: "이메일과 인증코드를 입력해 주세요.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedCode = String(code).trim();

    const userResult = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail],
    );

    if (!userResult.rows[0]) {
      return res.status(404).json({
        verified: false,
        message: "회원가입되지 않은 이메일입니다.",
      });
    }

    const saved = passwordResetCodes.get(normalizedEmail);

    if (!saved) {
      return res.status(400).json({
        verified: false,
        message: "인증코드가 존재하지 않습니다.",
      });
    }

    if (Date.now() > saved.expires) {
      passwordResetCodes.delete(normalizedEmail);
      return res.status(400).json({
        verified: false,
        message: "인증코드가 만료되었습니다.",
      });
    }

    if (saved.code !== normalizedCode) {
      return res.status(400).json({
        verified: false,
        message: "인증되지 않았습니다.",
      });
    }

    const verifiedToken = createEphemeralToken();
    passwordResetCodes.set(normalizedEmail, {
      ...saved,
      verified: true,
      verifiedToken,
    });

    return res.json({
      verified: true,
      message: "인증되었습니다.",
      resetToken: verifiedToken,
    });
  });

  app.post("/api/auth/password-reset/confirm", async (req, res) => {
    const { email, code, newPassword, resetToken } = req.body ?? {};

    if (!email || !code || !newPassword || !resetToken) {
      return res.status(400).json({
        message: "이메일, 인증코드, 인증 토큰, 새 비밀번호를 모두 입력해 주세요.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedCode = String(code).trim();
    const password = String(newPassword);

    const userResult = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail],
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: "회원가입되지 않은 이메일입니다." });
    }

    const saved = passwordResetCodes.get(normalizedEmail);

    if (!saved) {
      return res.status(400).json({ message: "인증코드가 존재하지 않습니다." });
    }

    if (Date.now() > saved.expires) {
      passwordResetCodes.delete(normalizedEmail);
      return res.status(400).json({ message: "인증코드가 만료되었습니다." });
    }

    if (saved.code !== normalizedCode || !saved.verified || saved.verifiedToken !== String(resetToken)) {
      return res.status(400).json({ message: "비밀번호 재설정 인증이 완료되지 않았습니다." });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*[^A-Za-z0-9]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ message: "비밀번호는 8자 이상이며 영문과 특수문자를 포함해야 합니다." });
    }

    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashPassword(password), user.id]);
    passwordResetCodes.delete(normalizedEmail);

    return res.json({ success: true, message: "비밀번호가 재설정되었습니다." });
  });

  app.post("/api/auth/email/send-code", async (req, res) => {
    const { email } = req.body ?? {};

    if (!email) {
      return res.status(400).json({ success: false, message: "이메일이 필요합니다." });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        success: false,
        message: "이메일 발송 환경변수가 설정되지 않았습니다.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "올바른 이메일 형식이 아닙니다." });
    }

    const existingUser = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [normalizedEmail],
    );

    if (existingUser.rows[0]) {
      return res.status(409).json({ success: false, message: "이미 가입된 이메일입니다." });
    }

    const code = createEmailCode();
    const expires = Date.now() + 1000 * 60 * 5;

    try {
      await transporter.sendMail({
        from: `"Lydian Larnell" <${process.env.EMAIL_USER}>`,
        to: normalizedEmail,
        subject: "Lydian Larnell 이메일 인증코드",
        text: `인증코드는 ${code} 입니다. 5분 이내에 입력해 주세요.`,
        html: buildVerificationEmailHtml("이메일 인증코드", "아래 6자리 인증코드를 입력해 주세요.", code),
      });

      emailCodes.set(normalizedEmail, { code, expires });

      return res.json({ success: true, message: "인증코드가 발송되었습니다." });
    } catch (error) {
      console.error("메일 발송 실패:", error);
      return res.status(500).json({ success: false, message: "메일 발송에 실패했습니다." });
    }
  });

  app.post("/api/auth/email/verify-code", (req, res) => {
    const { email, code } = req.body ?? {};

    if (!email || !code) {
      return res.status(400).json({ verified: false, message: "이메일과 인증코드를 입력해 주세요." });
    }

    const normalizedEmail = normalizeEmail(email);
    const saved = emailCodes.get(normalizedEmail);

    if (!saved) {
      return res.status(400).json({ verified: false, message: "인증코드가 존재하지 않습니다." });
    }

    if (Date.now() > saved.expires) {
      emailCodes.delete(normalizedEmail);
      return res.status(400).json({ verified: false, message: "인증코드가 만료되었습니다." });
    }

    if (saved.code !== String(code).trim()) {
      return res.status(400).json({ verified: false, message: "인증되지 않았습니다." });
    }

    emailCodes.delete(normalizedEmail);
    return res.json({ verified: true, message: "인증되었습니다." });
  });

  app.get("/api/users/me/settings", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const result = await pool.query(`SELECT * FROM user_settings WHERE user_id = $1`, [user.id]);
    res.json({ settings: result.rows[0] ? mapUserSettings(result.rows[0]) : {} });
  });

  app.put("/api/users/me/settings", upload.single("profileImageFile"), async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const existingSettingsResult = await pool.query(`SELECT * FROM user_settings WHERE user_id = $1`, [user.id]);
    const existingSettings = existingSettingsResult.rows[0];

    const profileImageFile = req.file;
    const body = req.body ?? {};

    try {
      if (profileImageFile) {
        validateFileSignature(profileImageFile, "image");
      }
    } catch (error) {
      safeUnlink(profileImageFile?.path);
      return res.status(400).json({ message: error instanceof Error ? error.message : "프로필 이미지 검증에 실패했습니다." });
    }

    const profileImagePath = profileImageFile
      ? `/uploads/profile-images/${profileImageFile.filename}`
      : normalizeOptionalText(body.profileImage) ?? existingSettings?.profile_image ?? null;

    await pool.query(
      `INSERT INTO user_settings (user_id, nickname, profile_image, bio, email, instagram, layout, language, notifications_enabled, last_nickname_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id)
       DO UPDATE SET
         nickname = EXCLUDED.nickname,
         profile_image = COALESCE(EXCLUDED.profile_image, user_settings.profile_image),
         bio = EXCLUDED.bio,
         email = EXCLUDED.email,
         instagram = EXCLUDED.instagram,
         layout = EXCLUDED.layout,
         language = EXCLUDED.language,
         notifications_enabled = EXCLUDED.notifications_enabled,
         last_nickname_change = EXCLUDED.last_nickname_change`,
      [
        user.id,
        normalizeOptionalText(body.nickname),
        profileImagePath,
        normalizeOptionalText(body.bio),
        normalizeOptionalText(body.email),
        normalizeOptionalText(body.instagram),
        normalizeOptionalText(body.layout) || existingSettings?.layout || "horizontal",
        normalizeOptionalText(body.language) || existingSettings?.language || "ko",
        resolveNotificationsEnabled(body.notificationsEnabled, existingSettings?.notifications_enabled ?? true),
        body.lastNicknameChange ? Number(body.lastNicknameChange) : existingSettings?.last_nickname_change ?? null,
      ],
    );

    const result = await pool.query(`SELECT * FROM user_settings WHERE user_id = $1`, [user.id]);
    res.json({ success: true, settings: result.rows[0] ? mapUserSettings(result.rows[0]) : {} });
  });

  app.get("/api/users/me/contents", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const result = await pool.query(
      `SELECT id, title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, created_at, pdf_price, is_sanctioned, sanction_reason, sanctioned_at
       FROM contents
       WHERE author_id = $1
       ORDER BY created_at DESC`,
      [user.id],
    );

    res.json({ contents: result.rows.map(mapContent) });
  });

  app.get("/api/subscriptions", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const result = await pool.query(
      `SELECT s.target_id, s.notify, u.name, us.nickname
       FROM subscriptions s
       JOIN users u ON u.id = s.target_id
       LEFT JOIN user_settings us ON us.user_id = s.target_id
       WHERE s.user_id = $1 AND u.deleted_at IS NULL
       ORDER BY s.created_at DESC`,
      [user.id],
    );

    res.json({
      subscriptions: result.rows.map((row) => ({
        targetId: row.target_id,
        notify: row.notify,
        name: row.nickname || row.name,
      })),
    });
  });

  app.get("/api/users/:id/profile", async (req, res) => {
    const targetId = req.params.id;
    const userResult = await pool.query(
      `SELECT id, email, name, role, upgrade_request_status FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [targetId],
    );

    const targetUser = userResult.rows[0];
    if (!targetUser || targetUser.role !== "musician") {
      return res.status(404).json({ message: "뮤지션을 찾을 수 없습니다." });
    }

    const settingsResult = await pool.query(`SELECT * FROM user_settings WHERE user_id = $1`, [targetId]);
    const contentsResult = await pool.query(
      `SELECT id, title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, created_at, pdf_price, is_sanctioned, sanction_reason, sanctioned_at
       FROM contents
       WHERE author_id = $1
       ORDER BY created_at DESC`,
      [targetId],
    );

    let subscription = { subscribed: false, notify: false };
    if (req.session.user) {
      const subscriptionResult = await pool.query(
        `SELECT notify FROM subscriptions WHERE user_id = $1 AND target_id = $2 LIMIT 1`,
        [req.session.user.id, targetId],
      );
      if (subscriptionResult.rows[0]) {
        subscription = { subscribed: true, notify: Boolean(subscriptionResult.rows[0].notify) };
      }
    }

    res.json({
      user: mapUser(targetUser),
      settings: settingsResult.rows[0] ? mapUserSettings(settingsResult.rows[0]) : {},
      contents: contentsResult.rows.map(mapContent),
      subscription,
    });
  });

  app.delete("/api/users/me", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const reason = (req.body?.reason as string | undefined) || "";

    await pool.query(`INSERT INTO deleted_accounts (user_id, email, reason) VALUES ($1, $2, $3)`, [user.id, user.email, reason]);
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE id = $1`, [user.id]);

    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.post(
    "/api/applications",
    upload.fields([
      { name: "videoFile", maxCount: 1 },
      { name: "signedContractFile", maxCount: 1 },
    ]),
    async (req, res) => {
      const user = requireAuth(req, res);
      if (!user) return;

      const {
        name,
        nickname,
        category,
        email,
        bankName,
        accountNumber,
        accountHolder,
        contractChecked,
      } = req.body ?? {};

      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      const videoFile = files?.videoFile?.[0];
      const signedContractFile = files?.signedContractFile?.[0];

      if (!name || !nickname || !category || !email || !bankName || !accountNumber || !accountHolder || !videoFile) {
        safeUnlink(videoFile?.path);
        safeUnlink(signedContractFile?.path);
        return res.status(400).json({ message: "지원 정보가 누락되었습니다." });
      }

      if (!signedContractFile) {
        safeUnlink(videoFile?.path);
        return res.status(400).json({ message: "서명한 계약서를 업로드해 주세요." });
      }

      if (contractChecked !== "true") {
        safeUnlink(videoFile?.path);
        safeUnlink(signedContractFile?.path);
        return res.status(400).json({ message: "계약서를 확인하고 동의 체크를 해주세요." });
      }

      try {
        validateFileSignature(videoFile, "video");
        validateFileSignature(signedContractFile, "pdf");
      } catch (error) {
        safeUnlink(videoFile.path);
        safeUnlink(signedContractFile.path);
        return res.status(400).json({ message: error instanceof Error ? error.message : "파일 검증에 실패했습니다." });
      }

      const existing = await pool.query(
        `SELECT id FROM musician_applications WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );

      if (existing.rows[0]) {
        safeUnlink(videoFile.path);
        safeUnlink(signedContractFile.path);
        return res.status(409).json({ message: "이미 대기 중인 승급 요청이 있습니다." });
      }

      const videoPath = `/uploads/videos/${videoFile.filename}`;
      const signedContractPath = `/uploads/contracts/${signedContractFile.filename}`;

      const result = await pool.query(
        `INSERT INTO musician_applications (
          user_id,
          name,
          nickname,
          category,
          email,
          bank_name,
          account_number,
          account_holder,
          video_file_name,
          video_size,
          video_path,
          signed_contract_file_name,
          signed_contract_size,
          signed_contract_path,
          contract_checked,
          status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        )
        RETURNING
          id,
          user_id,
          name,
          nickname,
          category,
          email,
          bank_name,
          account_number,
          account_holder,
          video_file_name,
          video_size,
          video_path,
          signed_contract_file_name,
          signed_contract_size,
          signed_contract_path,
          contract_checked,
          created_at,
          status`,
        [
          user.id,
          name,
          nickname,
          category,
          normalizeEmail(email),
          bankName,
          accountNumber,
          accountHolder,
          videoFile.originalname,
          videoFile.size,
          videoPath,
          signedContractFile.originalname,
          signedContractFile.size,
          signedContractPath,
          true,
          "pending",
        ],
      );

      await pool.query(`UPDATE users SET upgrade_request_status = 'pending' WHERE id = $1`, [user.id]);

      const refreshed = await pool.query(
        `SELECT id, email, name, role, upgrade_request_status FROM users WHERE id = $1`,
        [user.id],
      );

      req.session.user = mapUser(refreshed.rows[0]);

      const row = result.rows[0];

      res.json({
        application: {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          nickname: row.nickname,
          category: row.category,
          email: row.email,
          bankName: row.bank_name,
          accountNumber: row.account_number,
          accountHolder: row.account_holder,
          videoFileName: row.video_file_name,
          videoSize: row.video_size ? Number(row.video_size) : undefined,
          videoPath: row.video_path || undefined,
          signedContractFileName: row.signed_contract_file_name || undefined,
          signedContractSize: row.signed_contract_size ? Number(row.signed_contract_size) : undefined,
          signedContractPath: row.signed_contract_path || undefined,
          contractChecked: row.contract_checked,
          createdAt: row.created_at,
          status: row.status,
        },
        user: req.session.user,
      });
    },
  );

  app.get("/api/admin/dashboard", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const appsResult = await pool.query(
      `SELECT id, user_id, name, nickname, category, email, bank_name, account_number, account_holder, video_file_name, video_size, video_path, signed_contract_file_name, signed_contract_size, signed_contract_path, contract_checked, created_at, status
       FROM musician_applications
       ORDER BY created_at DESC`,
    );
    const settingsResult = await pool.query(`SELECT * FROM user_settings`);
    const contentsResult = await pool.query(`SELECT id, author_id, is_sanctioned FROM contents ORDER BY created_at DESC`);

    const normalizedApps = appsResult.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      nickname: row.nickname,
      category: row.category,
      email: row.email,
      bankName: row.bank_name,
      accountNumber: row.account_number,
      accountHolder: row.account_holder,
      videoFileName: row.video_file_name,
      videoSize: row.video_size ? Number(row.video_size) : undefined,
      videoPath: row.video_path || undefined,
      signedContractPath: row.signed_contract_path || undefined,
      signedContractFileName: row.signed_contract_file_name || undefined,
      signedContractSize: row.signed_contract_size ? Number(row.signed_contract_size) : undefined,
      contractChecked: row.contract_checked,
      createdAt: row.created_at,
      status: row.status,
    }));

    const settings = settingsResult.rows.reduce<Record<string, ReturnType<typeof mapUserSettings>>>((acc, row) => {
      acc[row.user_id] = mapUserSettings(row);
      return acc;
    }, {});

    const contents = contentsResult.rows.map((row) => ({ id: row.id, authorId: row.author_id, isSanctioned: row.is_sanctioned }));

    res.json({
      applications: normalizedApps.filter((app) => app.status === "pending"),
      processedApplications: normalizedApps.filter((app) => app.status !== "pending"),
      settings,
      contents,
    });
  });

  app.get("/api/admin/applications/:id/contract-download", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const result = await pool.query(
      `SELECT signed_contract_path, signed_contract_file_name FROM musician_applications WHERE id = $1`,
      [req.params.id],
    );

    const application = result.rows[0];
    if (!application?.signed_contract_path) {
      return res.status(404).json({ message: "계약서 파일을 찾을 수 없습니다." });
    }

    const absolutePath = assertOwnedFilePath(path.join(process.cwd(), application.signed_contract_path.replace(/^\//, "")), contractsDir);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: "계약서 파일이 존재하지 않습니다." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(application.signed_contract_file_name || 'signed-contract.pdf')}`);
    return res.sendFile(absolutePath);
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const targetId = req.params.id;
    const userResult = await pool.query(
      `SELECT id, email, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [targetId],
    );

    const targetUser = userResult.rows[0];
    if (!targetUser) {
      return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    }

    if (targetUser.role === "admin") {
      return res.status(400).json({ message: "관리자 계정은 삭제할 수 없습니다." });
    }

    const sanctionedCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM contents WHERE author_id = $1 AND is_sanctioned = TRUE`,
      [targetId],
    );

    if ((sanctionedCountResult.rows[0]?.count ?? 0) < 2) {
      return res.status(400).json({ message: "제재 영상이 2개 이상일 때만 계정 삭제가 가능합니다." });
    }

    await pool.query(`INSERT INTO deleted_accounts (user_id, email, reason) VALUES ($1, $2, $3)`, [targetId, targetUser.email, "관리자 삭제"]);
    await pool.query(`UPDATE users SET deleted_at = NOW() WHERE id = $1`, [targetId]);

    res.json({ success: true });
  });

  app.post("/api/admin/applications/:id/approve", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    const appResult = await pool.query(`SELECT * FROM musician_applications WHERE id = $1`, [id]);
    const application = appResult.rows[0];

    if (!application) {
      return res.status(404).json({ message: "지원서를 찾을 수 없습니다." });
    }

    await pool.query(`UPDATE users SET role = 'musician', upgrade_request_status = 'approved' WHERE id = $1`, [application.user_id]);
    await pool.query(`UPDATE musician_applications SET status = 'approved' WHERE id = $1`, [id]);

    await pool.query(
      `INSERT INTO user_settings (user_id, nickname)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET nickname = COALESCE(user_settings.nickname, EXCLUDED.nickname)`,
      [application.user_id, application.nickname],
    );

    res.json({ success: true });
  });

  app.post("/api/admin/applications/:id/reject", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    const appResult = await pool.query(`SELECT * FROM musician_applications WHERE id = $1`, [id]);
    const application = appResult.rows[0];

    if (!application) {
      return res.status(404).json({ message: "지원서를 찾을 수 없습니다." });
    }

    await pool.query(`UPDATE users SET upgrade_request_status = 'rejected' WHERE id = $1`, [application.user_id]);
    await pool.query(`UPDATE musician_applications SET status = 'rejected' WHERE id = $1`, [id]);

    res.json({ success: true });
  });

  app.post("/api/admin/contents/:id/sanction", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { reason } = req.body ?? {};

    if (!reason) {
      return res.status(400).json({ message: "삭제 사유가 필요합니다." });
    }

    await pool.query(
      `UPDATE contents
      SET is_sanctioned = TRUE,
          sanction_reason = $1,
          sanctioned_at = NOW()
      WHERE id = $2`,
      [reason, id]
    );

    res.json({ success: true });
  });

  app.post("/api/admin/contents/:id/unsanction", async (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    await pool.query(
      `UPDATE contents
      SET is_sanctioned = FALSE,
          sanction_reason = NULL,
          sanctioned_at = NULL
      WHERE id = $1`,
      [id]
    );

    res.json({ success: true });
  });

  app.post(
    "/api/contents",
    upload.fields([
      { name: "thumbnail", maxCount: 1 },
      { name: "videoFile", maxCount: 1 },
      { name: "pdfFile", maxCount: 1 },
    ]),
    async (req, res) => {
      const user = requireAuth(req, res);
      if (!user) return;

      if (user.role !== "musician" && user.role !== "admin") {
        return res.status(403).json({ message: "뮤지션만 업로드할 수 있습니다." });
      }

      const {
        title,
        description,
        category,
        videoUrl,
        authorName,
        pdfPrice,
      } = req.body ?? {};

      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      const thumbnailFile = files?.thumbnail?.[0];
      const videoFile = files?.videoFile?.[0];
      const pdfFile = files?.pdfFile?.[0];

      const cleanupFiles = () => {
        safeUnlink(thumbnailFile?.path);
        safeUnlink(videoFile?.path);
        safeUnlink(pdfFile?.path);
      };

      if (!title || !description || !category) {
        cleanupFiles();
        return res.status(400).json({ message: "제목, 설명, 카테고리는 필수입니다." });
      }

      if (!thumbnailFile) {
        cleanupFiles();
        return res.status(400).json({ message: "썸네일 이미지는 필수입니다." });
      }

      if (!videoUrl && !videoFile) {
        cleanupFiles();
        return res.status(400).json({ message: "영상 URL 또는 영상 파일이 필요합니다." });
      }

      if (videoUrl && videoFile) {
        cleanupFiles();
        return res.status(400).json({ message: "영상 URL과 영상 파일은 동시에 등록할 수 없습니다." });
      }

      const parsedPdfPrice = Number(pdfPrice || 0);
      if (pdfFile && parsedPdfPrice > 0 && parsedPdfPrice < 1000) {
        cleanupFiles();
        return res.status(400).json({ message: "유료 PDF 가격은 1000원 이상이어야 합니다." });
      }

      try {
        validateFileSignature(thumbnailFile, "image");
        if (videoFile) validateFileSignature(videoFile, "video");
        if (pdfFile) validateFileSignature(pdfFile, "pdf");
      } catch (error) {
        cleanupFiles();
        return res.status(400).json({ message: error instanceof Error ? error.message : "파일 검증에 실패했습니다." });
      }

      const thumbnailPath = `/uploads/thumbnails/${thumbnailFile.filename}`;
      const videoFilePath = videoFile ? `/uploads/videos/${videoFile.filename}` : null;
      const pdfFilePath = pdfFile ? `/uploads/pdfs/${pdfFile.filename}` : null;

      const result = await pool.query(
        `INSERT INTO contents (title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, pdf_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, title, description, category, thumbnail, video_url, video_file, pdf_file, pdf_file_name, author_id, author_name, created_at, pdf_price`,
        [
          String(title).trim(),
          String(description).trim(),
          String(category).trim(),
          thumbnailPath,
          normalizeOptionalText(videoUrl),
          videoFilePath,
          pdfFilePath,
          pdfFile?.originalname || null,
          user.id,
          normalizeOptionalText(authorName) || user.name,
          Number.isFinite(parsedPdfPrice) ? parsedPdfPrice : 0,
        ],
      );

      const row = result.rows[0];

      void sendNewContentNotificationEmail(
        {
          title: row.title,
          authorName: row.author_name,
          category: row.category,
          id: row.id,
        },
        user.id,
      );

      res.json({
        content: {
          id: row.id,
          title: row.title,
          description: row.description,
          category: row.category,
          thumbnail: row.thumbnail,
          videoUrl: row.video_url || "",
          videoFile: row.video_file || undefined,
          pdfFile: row.pdf_file || undefined,
          pdfFileName: row.pdf_file_name || undefined,
          authorId: row.author_id,
          authorName: row.author_name,
          createdAt: row.created_at,
          pdfPrice: Number(row.pdf_price || 0),
        },
      });
    },
  );

  app.delete("/api/contents/:id", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM contents WHERE id = $1 AND author_id = $2 RETURNING id, thumbnail, video_file, pdf_file`,
      [id, user.id],
    );

    const deleted = result.rows[0];
    if (!deleted) {
      return res.status(404).json({ message: "삭제할 콘텐츠를 찾을 수 없습니다." });
    }

    for (const filePath of [deleted.thumbnail, deleted.video_file, deleted.pdf_file]) {
      if (filePath) {
        safeUnlink(path.join(process.cwd(), String(filePath).replace(/^\//, "")));
      }
    }

    res.json({ success: true });
  });

  app.post("/api/subscriptions/toggle", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const { targetId } = req.body ?? {};

    if (!targetId) {
      return res.status(400).json({ message: "대상 사용자가 필요합니다." });
    }

    const existing = await pool.query(
      `SELECT id FROM subscriptions WHERE user_id = $1 AND target_id = $2`,
      [user.id, targetId],
    );

    if (existing.rows[0]) {
      await pool.query(`DELETE FROM subscriptions WHERE user_id = $1 AND target_id = $2`, [user.id, targetId]);
      return res.json({ subscribed: false, notify: false });
    }

    await pool.query(`INSERT INTO subscriptions (user_id, target_id, notify) VALUES ($1, $2, TRUE)`, [user.id, targetId]);

    res.json({ subscribed: true, notify: true });
  });

  app.post("/api/subscriptions/notify", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const { targetId, notify } = req.body ?? {};

    await pool.query(`UPDATE subscriptions SET notify = $3 WHERE user_id = $1 AND target_id = $2`, [
      user.id,
      targetId,
      !!notify,
    ]);

    res.json({ success: true });
  });

  app.post("/api/purchases", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;

    const { contentId } = req.body ?? {};

    if (!contentId) {
      return res.status(400).json({ message: "contentId가 필요합니다." });
    }

    const contentResult = await pool.query(
      `SELECT id, is_sanctioned FROM contents WHERE id = $1`,
      [contentId],
    );

    const content = contentResult.rows[0];

    if (!content) {
      return res.status(404).json({ message: "콘텐츠를 찾을 수 없습니다." });
    }

    if (content.is_sanctioned) {
      return res.status(403).json({ message: "제재된 콘텐츠는 구매할 수 없습니다." });
    }

    await pool.query(
      `INSERT INTO purchases (user_id, content_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, content_id) DO NOTHING`,
      [user.id, contentId],
    );

    res.json({ success: true });
  });

  return httpServer;
}