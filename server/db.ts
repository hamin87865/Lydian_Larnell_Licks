import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const dbSslMode = (process.env.DB_SSL_MODE || "auto").toLowerCase();

function resolveSsl() {
  if (dbSslMode === "disable" || dbSslMode === "false") {
    return false;
  }

  if (dbSslMode === "require" || dbSslMode === "true") {
    return { rejectUnauthorized: false };
  }

  if (!databaseUrl) {
    return false;
  }

  const isLocalConnection = /localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\./i.test(databaseUrl);
  return isLocalConnection ? false : { rejectUnauthorized: false };
}

function maskHost(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const host = url.hostname || "unknown";

    if (host.length <= 4) {
      return `${host.slice(0, 1)}***`;
    }

    return `${host.slice(0, 2)}***${host.slice(-2)}`;
  } catch {
    return "unknown";
  }
}

function classifyDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";

  if (code === "28P01") return "DB 인증 실패";
  if (code === "3D000") return "DB 데이터베이스 없음";
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH"].includes(code)) return "DB 네트워크 연결 실패";
  if (/ssl/i.test(message)) return "DB SSL 설정 불일치";
  return "DB 연결 실패";
}

if (!databaseUrl) {
  console.warn("[db] DATABASE_URL 이 설정되지 않았습니다.");
} else {
  const ssl = resolveSsl();
  console.info(
    `[db] PostgreSQL 사용 (${ssl ? "ssl" : "non-ssl"}, host=${maskHost(databaseUrl)}, env=${process.env.NODE_ENV || "development"})`,
  );
}

export const pool = new Pool(
  databaseUrl
    ? {
        connectionString: databaseUrl,
        ssl: resolveSsl(),
      }
    : undefined,
);

export async function ensureDatabase() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  }

  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  } catch (error) {
    const reason = classifyDbError(error);
    throw new Error(`${reason}: ${error instanceof Error ? error.message : String(error)}`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'basic',
      upgrade_request_status TEXT NOT NULL DEFAULT 'none',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT,
      profile_image TEXT,
      bio TEXT,
      email TEXT,
      instagram TEXT,
      layout TEXT DEFAULT 'horizontal',
      language TEXT DEFAULT 'ko',
      notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_nickname_change BIGINT
    );

    CREATE TABLE IF NOT EXISTS contents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      thumbnail TEXT NOT NULL,
      video_url TEXT,
      video_file TEXT,
      pdf_file TEXT,
      pdf_file_name TEXT,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      pdf_price NUMERIC(12, 2) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS musician_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      nickname TEXT NOT NULL,
      category TEXT NOT NULL,
      email TEXT NOT NULL,
      video_file_name TEXT NOT NULL,
      video_size BIGINT,
      video_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notify BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_id UUID NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, content_id)
    );

    CREATE TABLE IF NOT EXISTS deleted_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      email TEXT NOT NULL,
      reason TEXT,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS video_path TEXT;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS signed_contract_file_name TEXT;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS signed_contract_size BIGINT;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS signed_contract_path TEXT;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS contract_checked BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS bank_name TEXT;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS account_number TEXT;`);
  await pool.query(`ALTER TABLE musician_applications ADD COLUMN IF NOT EXISTS account_holder TEXT;`);
  await pool.query(`ALTER TABLE contents ALTER COLUMN video_url DROP NOT NULL;`);
  await pool.query(`ALTER TABLE contents ADD COLUMN IF NOT EXISTS is_sanctioned BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE contents ADD COLUMN IF NOT EXISTS sanction_reason TEXT;`);
  await pool.query(`ALTER TABLE contents ADD COLUMN IF NOT EXISTS sanctioned_at TIMESTAMPTZ;`);

  await pool.query(
    `
      INSERT INTO users (email, password_hash, name, role, upgrade_request_status)
      VALUES ($1, $2, $3, 'admin', 'none')
      ON CONFLICT (email) DO NOTHING
    `,
    ["admin@lydian.com", "plain:admin1234", "시스템 관리자"],
  );
}

export function createSessionStore() {
  const PgStore = connectPgSimple(session);
  return new PgStore({
    pool,
    tableName: "session",
    createTableIfMissing: true,
  });
}
