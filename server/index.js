import "dotenv/config";
import argon2 from "argon2";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import cors from "cors";
import { parse as parseCsv } from "csv-parse/sync";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const CLIENT_ORIGINS = (
  process.env.CLIENT_ORIGIN ||
  "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174"
)
  .split(",")
  .map((value) => value.trim());
const COOKIE_NAME = "bookclub_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_TOKEN = "7d";
const CURRENT_VOLUME = Number(process.env.CURRENT_VOLUME || process.env.CURRENT_SEASON || 2);
const PAST_VOLUME = Math.max(CURRENT_VOLUME - 1, 1);
const ALLOWED_ROLES = ["member", "admin"];
const COVER_ENRICHMENT_ENABLED =
  String(process.env.COVER_ENRICHMENT_ENABLED || "true").trim().toLowerCase() !== "false";
const COVER_LOOKUP_TIMEOUT_MS = Math.max(500, Number(process.env.COVER_LOOKUP_TIMEOUT_MS || 3000));
const FEATURED_IMAGE_MAX_BYTES = Math.max(
  512 * 1024,
  Number(process.env.FEATURED_IMAGE_MAX_BYTES || 5 * 1024 * 1024)
);
const ADMIN_RATE_LIMIT_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
);
const ADMIN_RATE_LIMIT_MAX = Math.max(
  30,
  Number(process.env.ADMIN_RATE_LIMIT_MAX || (process.env.NODE_ENV === "production" ? 200 : 1000))
);
const RESOURCE_LINK_LIMIT = 12;
const FEATURED_IMAGE_FALLBACK_LIMIT = 20;
const FEATURED_IMAGE_FALLBACKS_SETTING_KEY = "featured_image_fallback_urls";
const DEV_MEMBER_ACCOUNT_ENABLED =
  process.env.NODE_ENV !== "production" &&
  String(process.env.DEV_MEMBER_ACCOUNT_ENABLED || "true").trim().toLowerCase() !== "false";
const DEV_MEMBER_NAME = (process.env.DEV_MEMBER_NAME || "Demo Member").trim();
const DEV_MEMBER_EMAIL = (process.env.DEV_MEMBER_EMAIL || "member@example.com").trim().toLowerCase();
const DEV_MEMBER_PASSWORD = process.env.DEV_MEMBER_PASSWORD || "bookclub123";

if (JWT_SECRET === "dev-only-change-me") {
  console.warn(
    "Using fallback JWT secret. Set JWT_SECRET in .env before deploying to production."
  );
}

const DB_PATH = path.resolve("server", "data", "bookclub.db");
mkdirSync(path.dirname(DB_PATH), { recursive: true });
const PROFILE_IMAGES_DIR = path.resolve("server", "data", "profile-images");
mkdirSync(PROFILE_IMAGES_DIR, { recursive: true });
const FEATURED_IMAGES_DIR = path.resolve("server", "data", "featured-images");
mkdirSync(FEATURED_IMAGES_DIR, { recursive: true });
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  is_approved INTEGER NOT NULL DEFAULT 0,
  profile_image_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  volume INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT,
  month TEXT NOT NULL,
  meeting_starts_at TEXT,
  meeting_location TEXT,
  thumbnail_url TEXT,
  featured_image_url TEXT,
  resources_json TEXT NOT NULL DEFAULT '[]',
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  rating INTEGER,
  rated_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  book_id TEXT NOT NULL,
  parent_comment_id TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_likes (
  user_id INTEGER NOT NULL,
  comment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, comment_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_books_user_year ON books(user_id, year);
CREATE INDEX IF NOT EXISTS idx_comments_book ON comments(book_id);
CREATE TABLE IF NOT EXISTS reading_list_uploads (
  id TEXT PRIMARY KEY,
  admin_user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mode TEXT NOT NULL,
  rows_imported INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

ensureColumnExists("users", "role", "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
const addedApprovalColumn = ensureColumnExists(
  "users",
  "is_approved",
  "ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 0"
);
ensureColumnExists("users", "profile_image_url", "ALTER TABLE users ADD COLUMN profile_image_url TEXT");
const hasLegacySeasonColumn = tableHasColumn("books", "season");
const addedVolumeColumn = ensureColumnExists(
  "books",
  "volume",
  "ALTER TABLE books ADD COLUMN volume INTEGER NOT NULL DEFAULT 1"
);
ensureColumnExists("books", "thumbnail_url", "ALTER TABLE books ADD COLUMN thumbnail_url TEXT");
ensureColumnExists("books", "featured_image_url", "ALTER TABLE books ADD COLUMN featured_image_url TEXT");
ensureColumnExists(
  "books",
  "resources_json",
  "ALTER TABLE books ADD COLUMN resources_json TEXT NOT NULL DEFAULT '[]'"
);
ensureColumnExists("books", "isbn", "ALTER TABLE books ADD COLUMN isbn TEXT");
ensureColumnExists("books", "meeting_starts_at", "ALTER TABLE books ADD COLUMN meeting_starts_at TEXT");
ensureColumnExists("books", "meeting_location", "ALTER TABLE books ADD COLUMN meeting_location TEXT");
ensureColumnExists(
  "books",
  "is_completed",
  "ALTER TABLE books ADD COLUMN is_completed INTEGER NOT NULL DEFAULT 0"
);
ensureColumnExists("books", "completed_at", "ALTER TABLE books ADD COLUMN completed_at TEXT");
ensureColumnExists("books", "rating", "ALTER TABLE books ADD COLUMN rating INTEGER");
ensureColumnExists("books", "rated_at", "ALTER TABLE books ADD COLUMN rated_at TEXT");
ensureColumnExists("comments", "parent_comment_id", "ALTER TABLE comments ADD COLUMN parent_comment_id TEXT");
db.prepare(
  "UPDATE users SET role = 'member' WHERE role NOT IN ('member', 'admin') OR role IS NULL"
).run();
if (addedApprovalColumn) {
  // Preserve access for existing accounts when introducing approval gating.
  db.prepare("UPDATE users SET is_approved = 1").run();
}
db.prepare("UPDATE users SET is_approved = 1 WHERE role = 'admin'").run();
db.prepare("UPDATE users SET is_approved = 0 WHERE is_approved IS NULL").run();
db.prepare("UPDATE books SET is_completed = 0 WHERE is_completed IS NULL").run();
db.prepare("UPDATE books SET rating = NULL WHERE rating IS NOT NULL AND (rating < 1 OR rating > 5)").run();
const BASE_LEGACY_YEAR = new Date().getFullYear() - (CURRENT_VOLUME - 1);
if (addedVolumeColumn) {
  if (hasLegacySeasonColumn) {
    // Preserve historical grouping when migrating from the legacy `season` column.
    db.prepare("UPDATE books SET volume = season WHERE season IS NOT NULL").run();
  } else {
    // Legacy fallback when no season column exists: infer volume from year.
    db.prepare(
      `
      UPDATE books
      SET volume = CASE
        WHEN year >= ? THEN year - ? + 1
        ELSE 1
      END
    `
    ).run(BASE_LEGACY_YEAR, BASE_LEGACY_YEAR);
  }
}
db.prepare(
  `
  UPDATE books
  SET volume = CASE
    WHEN year >= ? THEN year - ? + 1
    ELSE 1
  END
  WHERE volume IS NULL OR volume < 1
`
).run(BASE_LEGACY_YEAR, BASE_LEGACY_YEAR);
db.prepare(
  `
  UPDATE comments
  SET parent_comment_id = NULL
  WHERE parent_comment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM comments parent
      WHERE parent.id = comments.parent_comment_id
    )
`
).run();
db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_approval ON users(is_approved)");
db.exec("CREATE INDEX IF NOT EXISTS idx_books_user_volume ON books(user_id, volume)");
db.exec("CREATE INDEX IF NOT EXISTS idx_books_meeting_starts_at ON books(meeting_starts_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON comment_likes(user_id)");

app.disable("x-powered-by");
app.use(
  helmet({
    // Allow the frontend on a different subdomain to embed uploaded images.
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (CLIENT_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error("CORS not allowed"), false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use("/api/uploads/profile-images", express.static(PROFILE_IMAGES_DIR, { fallthrough: false }));
app.use("/api/uploads/featured-images", express.static(FEATURED_IMAGES_DIR, { fallthrough: false }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }
});
const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});
const featuredImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FEATURED_IMAGE_MAX_BYTES }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." }
});

const adminLimiter = rateLimit({
  windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
  max: ADMIN_RATE_LIMIT_MAX,
  skip: (req) => req.method === "OPTIONS",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin requests. Please try again later." }
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128)
    .regex(/[A-Za-z]/, "Password must include at least one letter.")
    .regex(/[0-9]/, "Password must include at least one number.")
});

const loginSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
});

const commentSchema = z.object({
  text: z.string().trim().min(1).max(400),
  parentCommentId: z.union([z.string().trim().min(1).max(120), z.null()]).optional()
});
const commentParamsSchema = z.object({
  bookId: z.string().trim().min(1).max(120),
  commentId: z.string().trim().min(1).max(120)
});
const commentLikeSchema = z.object({
  liked: z.boolean()
});
const completionSchema = z.object({
  completed: z.boolean()
});
const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5)
});

function normalizeHttpOrRootRelativeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

const readingListModeSchema = z.enum(["append", "replace"]);
const singleRecordSchema = z.object({
  mode: readingListModeSchema.optional().default("append"),
  volume: z.coerce.number().int().min(1).max(99),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  month: z.string().trim().min(1).max(30),
  year: z.coerce.number().int().min(2025).max(2100),
  isbn: z
    .string()
    .trim()
    .transform((value) => normalizeIsbn(value))
    .refine((value) => Boolean(value), {
      message: "ISBN must be a valid ISBN-10 or ISBN-13."
    }),
  thumbnailUrl: z.string().trim().url().max(500),
  featuredImageUrl: z.string().trim().url().max(500).optional()
});
const isbnLookupSchema = z.object({
  isbn: z.string().trim().min(10).max(20)
});
const uploadVolumeSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  },
  z.number().int().min(1).max(99).optional()
);
const clearVolumeSchema = z.object({
  volume: z.coerce.number().int().min(1).max(99)
});
const pendingUserIdSchema = z.object({
  userId: z.coerce.number().int().min(1)
});
const memberParamsSchema = z.object({
  memberId: z.coerce.number().int().min(1)
});
const featureBookParamsSchema = z.object({
  bookId: z.string().trim().min(1).max(120)
});
const bookMeetingSchema = z.object({
  startsAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "A valid meeting date and time is required."
    }),
  location: z.string().trim().min(1).max(160)
});
const bookIsbnSchema = z.object({
  isbn: z.union([z.string(), z.null()]).optional()
});
const bookThumbnailSchema = z.object({
  thumbnailUrl: z.union([z.string().trim().url().max(500), z.null()]).optional()
});
const featuredImageFallbackSettingsSchema = z.object({
  urls: z
    .array(
      z
        .string()
        .trim()
        .max(500)
        .refine((value) => Boolean(normalizeHttpOrRootRelativeUrl(value)), {
          message: "Fallback URLs must be absolute http(s) URLs or root-relative paths."
        })
    )
    .max(FEATURED_IMAGE_FALLBACK_LIMIT)
});
const featuredImageFallbackDeleteSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => Boolean(normalizeHttpOrRootRelativeUrl(value)), {
      message: "A valid fallback image URL is required."
    })
});
const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80)
});
const resourceLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(500)
});
const readingListRowSchema = z.object({
  volume: z.coerce.number().int().min(1).max(99),
  year: z.coerce.number().int().min(2025).max(2100).optional(),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  isbn: z.string().regex(/^(?:\d{9}[\dX]|\d{13})$/).optional(),
  month: z.string().trim().min(1).max(30),
  meetingStartsAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: "meetingStartsAt must be a valid date/time."
    })
    .optional(),
  meetingLocation: z.string().trim().max(160).optional(),
  thumbnailUrl: z.string().trim().url().max(500).optional(),
  resources: z.array(resourceLinkSchema).max(RESOURCE_LINK_LIMIT).optional(),
  isFeatured: z.boolean()
});

function createSessionToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: SESSION_TTL_TOKEN
  });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = Number(payload.sub);
    const user = db
      .prepare("SELECT id, is_approved AS isApproved FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!Boolean(user.isApproved)) {
      clearSessionCookie(res);
      return res.status(403).json({ error: "Your account is pending admin approval." });
    }
    req.userId = userId;
    return next();
  } catch {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const user = db
      .prepare("SELECT id, role, is_approved AS isApproved FROM users WHERE id = ?")
      .get(req.userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!Boolean(user.isApproved)) {
      clearSessionCookie(res);
      return res.status(403).json({ error: "Your account is pending admin approval." });
    }
    if (user.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.userRole = user.role;
    return next();
  };
}

function formatUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isApproved: Boolean(user.isApproved ?? user.is_approved),
    profileImageUrl: user.profileImageUrl || user.profile_image_url || null
  };
}

function getProfileImageExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return null;
}

function getFeaturedImageExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return null;
}

function detectImageExtensionFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const hasBytes = (offset, values) =>
    values.every((value, index) => Number(buffer[offset + index]) === value);

  if (hasBytes(0, [0xff, 0xd8, 0xff])) return "jpg";
  if (hasBytes(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (hasBytes(0, [0x47, 0x49, 0x46, 0x38]) && (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61)
    return "gif";
  if (hasBytes(0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(8, [0x57, 0x45, 0x42, 0x50])) return "webp";
  return null;
}

function resolveImageExtension(file, fallbackFromMimeType) {
  const fromContent = detectImageExtensionFromBuffer(file?.buffer);
  if (fromContent) return fromContent;
  return fallbackFromMimeType(file?.mimetype || "");
}

function normalizeBookIdentityPart(value) {
  return String(value || "").trim().toLowerCase();
}

function getBookIdentity(volume, title, author) {
  return `${Number(volume)}::${normalizeBookIdentityPart(title)}::${normalizeBookIdentityPart(author)}`;
}

function hasSameBookIdentity(left, right) {
  return getBookIdentity(left?.volume, left?.title, left?.author) === getBookIdentity(right?.volume, right?.title, right?.author);
}

function getCommentLikeSummary(commentId, userId) {
  const likesCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?").get(commentId)?.count || 0
  );
  const liked = Boolean(
    db.prepare("SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?").get(commentId, userId)
  );
  return { likesCount, isLikedByUser: liked };
}

function removeStoredProfileImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return;
  const prefix = "/api/uploads/profile-images/";
  if (!imageUrl.startsWith(prefix)) return;
  const fileName = imageUrl.slice(prefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) return;
  const filePath = path.join(PROFILE_IMAGES_DIR, fileName);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Cleanup failure should not break profile updates.
  }
}

function removeStoredFeaturedImageIfUnused(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return;
  const prefix = "/api/uploads/featured-images/";
  if (!imageUrl.startsWith(prefix)) return;

  const inUseCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM books WHERE featured_image_url = ?").get(imageUrl)?.count || 0
  );
  if (inUseCount > 0) return;
  if (getFeaturedImageFallbackUrls().includes(imageUrl)) return;

  const fileName = imageUrl.slice(prefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) return;
  const filePath = path.join(FEATURED_IMAGES_DIR, fileName);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Cleanup failure should not block updates.
  }
}

function syncAdminRoleForConfiguredEmail(user) {
  if (!ADMIN_EMAIL) return user;
  if (!user?.email) return user;
  if (user.email.toLowerCase() !== ADMIN_EMAIL) return user;
  if (user.role === "admin" && Boolean(user.isApproved ?? user.is_approved)) return user;

  db.prepare("UPDATE users SET role = 'admin', is_approved = 1 WHERE id = ?").run(user.id);
  return { ...user, role: "admin", isApproved: true };
}

async function ensureDevMemberAccount() {
  if (!DEV_MEMBER_ACCOUNT_ENABLED) return;
  if (!DEV_MEMBER_EMAIL || !DEV_MEMBER_PASSWORD) return;
  if (ADMIN_EMAIL && DEV_MEMBER_EMAIL === ADMIN_EMAIL) {
    console.warn("DEV_MEMBER_EMAIL matches ADMIN_EMAIL; skipping dev member seed.");
    return;
  }

  const passwordHash = await argon2.hash(DEV_MEMBER_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(DEV_MEMBER_EMAIL);
  let userId;

  if (existing) {
    db.prepare(
      `
      UPDATE users
      SET name = ?, password_hash = ?, role = 'member', is_approved = 1
      WHERE id = ?
    `
    ).run(DEV_MEMBER_NAME || "Demo Member", passwordHash, existing.id);
    userId = existing.id;
  } else {
    const result = db.prepare(
      `
      INSERT INTO users (name, email, password_hash, role, is_approved, created_at)
      VALUES (?, ?, ?, 'member', 1, ?)
    `
    ).run(DEV_MEMBER_NAME || "Demo Member", DEV_MEMBER_EMAIL, passwordHash, now);
    userId = Number(result.lastInsertRowid);
  }

  const hasBooks = db.prepare("SELECT COUNT(*) AS count FROM books WHERE user_id = ?").get(userId).count > 0;
  if (!hasBooks) {
    seedBooksForUser(userId);
  }
}

function volumeToLegacyYear(volume) {
  return BASE_LEGACY_YEAR + Number(volume) - 1;
}

function legacyYearToVolume(year) {
  const volume = Number(year) - BASE_LEGACY_YEAR + 1;
  if (!Number.isFinite(volume)) return 1;
  return Math.max(1, volume);
}

function seedBooksForUser(userId) {
  const bookInsert = db.prepare(`
    INSERT INTO books (id, user_id, year, volume, title, author, month, is_featured, created_at)
    VALUES (@id, @user_id, @year, @volume, @title, @author, @month, @is_featured, @created_at)
  `);

  const commentInsert = db.prepare(`
    INSERT INTO comments (id, user_id, book_id, text, created_at)
    VALUES (@id, @user_id, @book_id, @text, @created_at)
  `);

  const seeds = {
    [CURRENT_VOLUME]: [
      {
        title: "The Ministry for the Future",
        author: "Kim Stanley Robinson",
        month: "February",
        isFeatured: 1,
        comments: ["Great opening discussion on climate policy."]
      },
      {
        title: "Tomorrow, and Tomorrow, and Tomorrow",
        author: "Gabrielle Zevin",
        month: "March",
        isFeatured: 0,
        comments: ["Potential pick for our game-dev themed month."]
      },
      {
        title: "Pachinko",
        author: "Min Jin Lee",
        month: "April",
        isFeatured: 0,
        comments: []
      },
      {
        title: "The Seven Husbands of Evelyn Hugo",
        author: "Taylor Jenkins Reid",
        month: "May",
        isFeatured: 0,
        comments: []
      },
      {
        title: "The Thursday Murder Club",
        author: "Richard Osman",
        month: "June",
        isFeatured: 0,
        comments: []
      }
    ],
    [PAST_VOLUME]: [
      {
        title: "Station Eleven",
        author: "Emily St. John Mandel",
        month: "January",
        isFeatured: 0,
        comments: ["One of our highest-rated books from last volume."]
      },
      {
        title: "The Nickel Boys",
        author: "Colson Whitehead",
        month: "May",
        isFeatured: 0,
        comments: []
      },
      {
        title: "Demon Copperhead",
        author: "Barbara Kingsolver",
        month: "September",
        isFeatured: 0,
        comments: []
      }
    ]
  };

  const insertSeedData = db.transaction(() => {
    for (const [volume, books] of Object.entries(seeds)) {
      for (const book of books) {
        const bookId = randomUUID();
        const createdAt = new Date().toISOString();
        bookInsert.run({
          id: bookId,
          user_id: userId,
          year: volumeToLegacyYear(Number(volume)),
          volume: Number(volume),
          title: book.title,
          author: book.author,
          month: book.month,
          is_featured: book.isFeatured,
          created_at: createdAt
        });

        for (const text of book.comments) {
          commentInsert.run({
            id: randomUUID(),
            user_id: userId,
            book_id: bookId,
            text,
            created_at: createdAt
          });
        }
      }
    }
  });

  insertSeedData();
}

function getBooksPayload(userId) {
  const books = db
    .prepare(
      `
      SELECT
        id,
        volume,
        year,
        title,
        author,
        isbn,
        month,
        meeting_starts_at AS meetingStartsAt,
        meeting_location AS meetingLocation,
        thumbnail_url AS thumbnailUrl,
        featured_image_url AS featuredImageUrl,
        resources_json AS resourcesJson,
        is_featured AS isFeatured,
        is_completed AS isCompleted,
        completed_at AS completedAt,
        rating AS userRating,
        rated_at AS ratedAt,
        (
          SELECT ROUND(AVG(b2.rating), 2)
          FROM books b2
          WHERE b2.volume = books.volume
            AND lower(b2.title) = lower(books.title)
            AND lower(b2.author) = lower(books.author)
            AND b2.rating IS NOT NULL
        ) AS averageRating,
        (
          SELECT COUNT(*)
          FROM books b2
          WHERE b2.volume = books.volume
            AND lower(b2.title) = lower(books.title)
            AND lower(b2.author) = lower(books.author)
            AND b2.rating IS NOT NULL
        ) AS ratingsCount,
        (
          SELECT COUNT(*)
          FROM books b2
          INNER JOIN users u2 ON u2.id = b2.user_id
          WHERE b2.volume = books.volume
            AND lower(b2.title) = lower(books.title)
            AND lower(b2.author) = lower(books.author)
            AND u2.is_approved = 1
        ) AS participantsCount,
        (
          SELECT COUNT(*)
          FROM books b2
          INNER JOIN users u2 ON u2.id = b2.user_id
          WHERE b2.volume = books.volume
            AND lower(b2.title) = lower(books.title)
            AND lower(b2.author) = lower(books.author)
            AND b2.is_completed = 1
            AND u2.is_approved = 1
        ) AS completedCount,
        created_at AS createdAt,
        CASE lower(month)
          WHEN 'january' THEN 1
          WHEN 'february' THEN 2
          WHEN 'march' THEN 3
          WHEN 'april' THEN 4
          WHEN 'may' THEN 5
          WHEN 'june' THEN 6
          WHEN 'july' THEN 7
          WHEN 'august' THEN 8
          WHEN 'september' THEN 9
          WHEN 'october' THEN 10
          WHEN 'november' THEN 11
          WHEN 'december' THEN 12
          ELSE 0
        END AS monthOrder
      FROM books
      WHERE user_id = ?
      ORDER BY volume DESC, year ASC, monthOrder ASC, created_at ASC
    `
    )
    .all(userId);

  const bookIdsByIdentity = books.reduce((acc, book) => {
    const identity = getBookIdentity(book.volume, book.title, book.author);
    if (!acc[identity]) acc[identity] = [];
    acc[identity].push(book.id);
    return acc;
  }, {});
  const visibleIdentities = new Set(Object.keys(bookIdsByIdentity));

  const comments = db
    .prepare(
      `
      SELECT
        c.id,
        c.book_id AS bookId,
        c.text,
        c.created_at AS createdAt,
        c.parent_comment_id AS parentCommentId,
        c.user_id AS authorUserId,
        u.name AS authorName,
        b.volume,
        b.title,
        b.author
      FROM comments c
      INNER JOIN books b ON b.id = c.book_id
      INNER JOIN users u ON u.id = c.user_id
      WHERE u.is_approved = 1
      ORDER BY c.created_at ASC
    `
    )
    .all()
    .filter((comment) => visibleIdentities.has(getBookIdentity(comment.volume, comment.title, comment.author)));

  const visibleCommentIds = new Set(comments.map((comment) => comment.id));
  const likeCountsByCommentId = new Map(
    db
      .prepare(
        `
        SELECT comment_id AS commentId, COUNT(*) AS likesCount
        FROM comment_likes
        GROUP BY comment_id
      `
      )
      .all()
      .map((row) => [row.commentId, Number(row.likesCount || 0)])
  );
  const likedByUser = new Set(
    db
      .prepare("SELECT comment_id AS commentId FROM comment_likes WHERE user_id = ?")
      .all(userId)
      .map((row) => row.commentId)
  );

  const commentsByBookId = comments.reduce((acc, comment) => {
    const identity = getBookIdentity(comment.volume, comment.title, comment.author);
    const targetBookIds = bookIdsByIdentity[identity] || [];
    const normalizedComment = {
      id: comment.id,
      text: comment.text,
      authorName: comment.authorName,
      authorUserId: Number(comment.authorUserId),
      parentCommentId:
        comment.parentCommentId && visibleCommentIds.has(comment.parentCommentId) ? comment.parentCommentId : null,
      createdAt: comment.createdAt,
      likesCount: Number(likeCountsByCommentId.get(comment.id) || 0),
      isLikedByUser: likedByUser.has(comment.id)
    };

    for (const targetBookId of targetBookIds) {
      if (!acc[targetBookId]) acc[targetBookId] = [];
      acc[targetBookId].push(normalizedComment);
    }
    return acc;
  }, {});

  const withComments = books.map((book) => ({
    id: book.id,
    volume: book.volume,
    year: book.year,
    title: book.title,
    author: book.author,
    isbn: book.isbn || null,
    month: book.month,
    meetingStartsAt: book.meetingStartsAt || null,
    meetingLocation: book.meetingLocation || "",
    thumbnailUrl: book.thumbnailUrl || null,
    featuredImageUrl: book.featuredImageUrl || null,
    resources: parseResourcesJson(book.resourcesJson),
    isFeatured: Boolean(book.isFeatured),
    isCompleted: Boolean(book.isCompleted),
    completedAt: book.completedAt || null,
    userRating: Number.isInteger(book.userRating) ? book.userRating : null,
    ratedAt: book.ratedAt || null,
    averageRating:
      book.averageRating === null || book.averageRating === undefined
        ? null
        : Number(book.averageRating),
    ratingsCount: Number(book.ratingsCount || 0),
    participantsCount: Number(book.participantsCount || 0),
    completedCount: Number(book.completedCount || 0),
    comments: commentsByBookId[book.id] || []
  }));
  const stripVolume = ({ volume, ...book }) => book;
  const volumesByNumber = withComments
    .reduce((acc, book) => {
      if (!acc[book.volume]) acc[book.volume] = [];
      acc[book.volume].push(stripVolume(book));
      return acc;
    }, {});
  if (!volumesByNumber[CURRENT_VOLUME]) volumesByNumber[CURRENT_VOLUME] = [];
  if (!volumesByNumber[PAST_VOLUME]) volumesByNumber[PAST_VOLUME] = [];
  const volumes = Object.entries(volumesByNumber)
    .map(([volume, volumeBooks]) => ({
      volume: Number(volume),
      books: volumeBooks
    }))
    .sort((a, b) => b.volume - a.volume);
  const pastVolumes = volumes.filter((group) => group.volume !== CURRENT_VOLUME);

  return {
    currentVolume: CURRENT_VOLUME,
    pastVolume: PAST_VOLUME,
    featuredImageFallbackUrls: getFeaturedImageFallbackUrls(),
    volumes,
    currentBooks: withComments
      .filter((book) => book.volume === CURRENT_VOLUME)
      .map(stripVolume),
    pastBooks: withComments
      .filter((book) => book.volume === PAST_VOLUME)
      .map(stripVolume),
    pastVolumes,
    otherBooks: withComments
      .filter((book) => book.volume !== CURRENT_VOLUME && book.volume !== PAST_VOLUME)
      .map(stripVolume)
  };
}

function listBookMeetings(volume) {
  return db
    .prepare(
      `
      SELECT
        MIN(id) AS id,
        volume,
        title,
        author,
        meeting_starts_at AS startsAt,
        meeting_location AS location
      FROM books
      WHERE meeting_starts_at IS NOT NULL
        AND trim(meeting_starts_at) != ''
        AND volume = ?
      GROUP BY volume, lower(title), lower(author)
      ORDER BY meeting_starts_at ASC, lower(title) ASC
    `
    )
    .all(volume);
}

function getMembersPayload() {
  const rows = db
    .prepare(
      `
      SELECT
        u.id,
        u.name,
        u.role,
        u.profile_image_url AS profileImageUrl,
        u.created_at AS createdAt,
        COUNT(c.id) AS commentsCount
      FROM users u
      LEFT JOIN comments c ON c.user_id = u.id
      WHERE u.is_approved = 1
      GROUP BY u.id, u.name, u.role, u.created_at
      ORDER BY lower(u.name) ASC
    `
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    profileImageUrl: row.profileImageUrl || null,
    createdAt: row.createdAt,
    commentsCount: Number(row.commentsCount || 0)
  }));
}

function getMemberProfilePayload(memberId, viewerUserId) {
  const member = db
    .prepare(
      `
      SELECT
        u.id,
        u.name,
        u.role,
        u.profile_image_url AS profileImageUrl,
        u.created_at AS createdAt,
        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.user_id = u.id
        ) AS commentsCount,
        (
          SELECT COUNT(*)
          FROM (
            SELECT volume, lower(title), lower(author)
            FROM books b
            WHERE b.user_id = u.id
              AND b.is_completed = 1
            GROUP BY volume, lower(title), lower(author)
          )
        ) AS booksRead
      FROM users u
      WHERE u.id = ? AND u.is_approved = 1
    `
    )
    .get(memberId);

  if (!member) return null;

  const recentComments = db
    .prepare(
      `
      SELECT
        c.id,
        c.text,
        c.created_at AS createdAt,
        b.id AS bookId,
        b.title AS bookTitle,
        b.author AS bookAuthor,
        b.volume,
        (
          SELECT b2.id
          FROM books b2
          WHERE b2.user_id = ?
            AND b2.volume = b.volume
            AND lower(b2.title) = lower(b.title)
            AND lower(b2.author) = lower(b.author)
          LIMIT 1
        ) AS viewerBookId
      FROM comments c
      INNER JOIN books b ON b.id = c.book_id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT 12
    `
    )
    .all(viewerUserId, memberId);

  return {
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
      profileImageUrl: member.profileImageUrl || null,
      createdAt: member.createdAt,
      commentsCount: Number(member.commentsCount || 0),
      booksRead: Number(member.booksRead || 0)
    },
    recentComments
  };
}

function getDashboardPayload() {
  const booksRead = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM (
        SELECT volume, lower(title), lower(author)
        FROM books
        GROUP BY volume, lower(title), lower(author)
      )
    `
    )
    .get().count;
  const currentVolumeBooks = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM (
        SELECT lower(title), lower(author)
        FROM books
        WHERE volume = ?
        GROUP BY lower(title), lower(author)
      )
    `
    )
    .get(CURRENT_VOLUME).count;
  const activeMembers = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE is_approved = 1")
    .get().count;
  const discussions = db.prepare("SELECT COUNT(*) AS count FROM comments").get().count;
  const upcomingEvents = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM (
        SELECT volume, lower(title), lower(author)
        FROM books
        WHERE meeting_starts_at IS NOT NULL
          AND trim(meeting_starts_at) != ''
          AND meeting_starts_at >= ?
        GROUP BY volume, lower(title), lower(author)
      )
    `
    )
    .get(new Date().toISOString()).count;

  return {
    stats: {
      booksRead: Number(booksRead || 0),
      activeMembers: Number(activeMembers || 0),
      discussions: Number(discussions || 0),
      upcomingEvents: Number(upcomingEvents || 0),
      currentVolumeBooks: Number(currentVolumeBooks || 0)
    },
    members: getMembersPayload(),
    schedule: listBookMeetings(CURRENT_VOLUME)
  };
}

function ensureColumnExists(tableName, columnName, alterStatement) {
  if (!tableHasColumn(tableName, columnName)) {
    db.exec(alterStatement);
    return true;
  }
  return false;
}

function tableHasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function sanitizeFeaturedImageFallbackUrls(urls) {
  if (!Array.isArray(urls)) return [];
  const deduped = [];
  const seen = new Set();
  for (const value of urls) {
    const normalized = normalizeHttpOrRootRelativeUrl(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= FEATURED_IMAGE_FALLBACK_LIMIT) break;
  }
  return deduped;
}

function getFeaturedImageFallbackUrls() {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(FEATURED_IMAGE_FALLBACKS_SETTING_KEY);
  if (!row?.value) return [];

  try {
    const parsed = JSON.parse(row.value);
    const sanitized = sanitizeFeaturedImageFallbackUrls(parsed);
    const normalizedValue = JSON.stringify(sanitized);
    if (normalizedValue !== row.value) {
      db.prepare(
        `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
      ).run(FEATURED_IMAGE_FALLBACKS_SETTING_KEY, normalizedValue);
    }
    return sanitized;
  } catch {
    return [];
  }
}

function saveFeaturedImageFallbackUrls(urls) {
  const sanitized = sanitizeFeaturedImageFallbackUrls(urls);
  db.prepare(
    `
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(FEATURED_IMAGE_FALLBACKS_SETTING_KEY, JSON.stringify(sanitized));
  return sanitized;
}

function parseBooleanLike(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "y"].includes(normalized);
  }
  return false;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseOptionalDateTime(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeIsbn(value) {
  if (value === undefined || value === null) return undefined;
  const compact = String(value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (!compact) return undefined;
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(compact)) return undefined;
  return compact;
}

function coerceHttpUrl(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function humanizeMegabytes(bytes) {
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${rounded}MB`;
}

function toHttpsUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

function buildThriftBooksIsbnLookupUrl(isbn) {
  if (!isbn) return undefined;
  return `https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(isbn)}`;
}

function mergeResourceLinks(primary, additions = []) {
  const merged = [];
  const seen = new Set();
  const pushResource = (resource) => {
    if (!resource || typeof resource !== "object") return;
    const label = String(resource.label || "").trim();
    const url = coerceHttpUrl(resource.url);
    if (!label || !url) return;
    const key = `${label.toLowerCase()}|${url.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ label, url });
  };

  for (const resource of primary || []) {
    pushResource(resource);
  }
  for (const resource of additions) {
    pushResource(resource);
  }

  if (merged.length === 0) return undefined;
  return merged.slice(0, RESOURCE_LINK_LIMIT);
}

function upsertThriftBooksResource(resources, isbn) {
  const thriftBooksUrl = buildThriftBooksIsbnLookupUrl(isbn);
  if (!thriftBooksUrl) return resources;

  const normalized = (resources || []).filter(
    (resource) => String(resource?.label || "").trim().toLowerCase() !== "thriftbooks"
  );
  return mergeResourceLinks(normalized, [{ label: "ThriftBooks", url: thriftBooksUrl }]);
}

function removeThriftBooksResource(resources) {
  return (resources || []).filter(
    (resource) => String(resource?.label || "").trim().toLowerCase() !== "thriftbooks"
  );
}

async function lookupOpenLibraryCover(isbn) {
  const probeUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  try {
    const response = await fetch(probeUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(COVER_LOOKUP_TIMEOUT_MS)
    });
    if (!response.ok) return undefined;
    return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  } catch {
    return undefined;
  }
}

async function lookupGoogleBooksCover(isbn) {
  const endpoint = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(
    isbn
  )}&maxResults=1&printType=books`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(COVER_LOOKUP_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const payload = await response.json();
    const imageLinks = payload?.items?.[0]?.volumeInfo?.imageLinks;
    if (!imageLinks) return undefined;
    const candidate =
      imageLinks.extraLarge ||
      imageLinks.large ||
      imageLinks.medium ||
      imageLinks.thumbnail ||
      imageLinks.smallThumbnail;
    return toHttpsUrl(candidate);
  } catch {
    return undefined;
  }
}

function extractGoogleBooksImageUrl(imageLinks) {
  if (!imageLinks) return undefined;
  const candidate =
    imageLinks.extraLarge ||
    imageLinks.large ||
    imageLinks.medium ||
    imageLinks.thumbnail ||
    imageLinks.smallThumbnail;
  return toHttpsUrl(candidate);
}

function getPublishedYear(publishedDate) {
  const match = String(publishedDate || "").match(/^(\d{4})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return undefined;
  return year;
}

function getPublishedMonthName(publishedDate) {
  const match = String(publishedDate || "").match(/^\d{4}-(\d{2})/);
  if (!match) return undefined;
  const monthIndex = Number(match[1]);
  if (!Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) return undefined;
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ][monthIndex - 1];
}

function getPublishedYearLoose(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  if (!match) return undefined;
  const year = Number(match[0]);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return undefined;
  return year;
}

function getPublishedMonthNameLoose(value) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const lower = raw.toLowerCase();
  for (const month of monthNames) {
    if (lower.includes(month.toLowerCase())) return month;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return monthNames[parsed.getMonth()];
  }
  return undefined;
}

async function lookupGoogleBooksByIsbn(isbn) {
  const endpoint = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(
    isbn
  )}&maxResults=1&printType=books`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(COVER_LOOKUP_TIMEOUT_MS) });
    if (!response.ok) return null;
    const payload = await response.json();
    const volume = payload?.items?.[0]?.volumeInfo;
    if (!volume) return null;
    const normalizedApiIsbn =
      normalizeIsbn(
        (volume.industryIdentifiers || []).find((entry) => String(entry?.type || "").toUpperCase() === "ISBN_13")
          ?.identifier
      ) ||
      normalizeIsbn(
        (volume.industryIdentifiers || []).find((entry) => String(entry?.type || "").toUpperCase() === "ISBN_10")
          ?.identifier
      ) ||
      isbn;
    return {
      title: String(volume.title || "").trim() || undefined,
      author: String(volume.authors?.[0] || "").trim() || undefined,
      year: getPublishedYear(volume.publishedDate),
      month: getPublishedMonthName(volume.publishedDate),
      thumbnailUrl: extractGoogleBooksImageUrl(volume.imageLinks),
      isbn: normalizedApiIsbn
    };
  } catch {
    return null;
  }
}

async function lookupOpenLibraryBookByIsbn(isbn) {
  const endpoint = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
    isbn
  )}&format=json&jscmd=data`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(COVER_LOOKUP_TIMEOUT_MS) });
    if (!response.ok) return null;
    const payload = await response.json();
    const entry = payload?.[`ISBN:${isbn}`];
    if (!entry) return null;
    const coverCandidate = entry?.cover?.large || entry?.cover?.medium || entry?.cover?.small;
    return {
      title: String(entry?.title || "").trim() || undefined,
      author: String(entry?.authors?.[0]?.name || "").trim() || undefined,
      year: getPublishedYearLoose(entry?.publish_date),
      month: getPublishedMonthNameLoose(entry?.publish_date),
      thumbnailUrl: toHttpsUrl(coverCandidate),
      isbn
    };
  } catch {
    return null;
  }
}

async function lookupBookByIsbn(isbn) {
  const google = await lookupGoogleBooksByIsbn(isbn);
  if (google) {
    if (!google.thumbnailUrl) {
      const openLibraryCover = await lookupOpenLibraryCover(isbn);
      if (openLibraryCover) google.thumbnailUrl = openLibraryCover;
    }
    return google;
  }

  const openLibrary = await lookupOpenLibraryBookByIsbn(isbn);
  if (!openLibrary) return null;
  if (!openLibrary.thumbnailUrl) {
    const openLibraryCover = await lookupOpenLibraryCover(isbn);
    if (openLibraryCover) openLibrary.thumbnailUrl = openLibraryCover;
  }
  return openLibrary;
}

async function resolveCoverForIsbn(isbn) {
  if (!isbn || !COVER_ENRICHMENT_ENABLED) return null;
  const openLibraryCover = await lookupOpenLibraryCover(isbn);
  return openLibraryCover || (await lookupGoogleBooksCover(isbn)) || null;
}

async function enrichRowsWithCovers(rows) {
  const coverCacheByIsbn = new Map();
  for (const row of rows) {
    if (row.isbn) {
      row.resources = upsertThriftBooksResource(row.resources, row.isbn);
    }

    if (!COVER_ENRICHMENT_ENABLED) continue;
    if (row.thumbnailUrl || !row.isbn) continue;
    if (!coverCacheByIsbn.has(row.isbn)) {
      const openLibraryCover = await lookupOpenLibraryCover(row.isbn);
      const resolvedCover = openLibraryCover || (await lookupGoogleBooksCover(row.isbn));
      coverCacheByIsbn.set(row.isbn, resolvedCover || null);
    }
    const cachedCover = coverCacheByIsbn.get(row.isbn);
    if (cachedCover) {
      row.thumbnailUrl = cachedCover;
    }
  }

  return rows;
}

async function backfillMissingCoversForExistingBooks() {
  if (!COVER_ENRICHMENT_ENABLED) {
    return {
      candidates: 0,
      isbnCandidates: 0,
      isbnResolved: 0,
      booksUpdated: 0,
      enrichmentEnabled: false
    };
  }

  const candidates = db
    .prepare(
      `
      SELECT id, isbn
      FROM books
      WHERE (thumbnail_url IS NULL OR trim(thumbnail_url) = '')
        AND isbn IS NOT NULL
        AND trim(isbn) != ''
    `
    )
    .all();

  const idsByNormalizedIsbn = new Map();
  for (const candidate of candidates) {
    const normalizedIsbn = normalizeIsbn(candidate.isbn);
    if (!normalizedIsbn) continue;
    if (!idsByNormalizedIsbn.has(normalizedIsbn)) {
      idsByNormalizedIsbn.set(normalizedIsbn, []);
    }
    idsByNormalizedIsbn.get(normalizedIsbn).push(candidate.id);
  }

  const coverByIsbn = new Map();
  for (const isbn of idsByNormalizedIsbn.keys()) {
    const openLibraryCover = await lookupOpenLibraryCover(isbn);
    const resolvedCover = openLibraryCover || (await lookupGoogleBooksCover(isbn));
    if (resolvedCover) {
      coverByIsbn.set(isbn, resolvedCover);
    }
  }

  const updates = [];
  for (const [isbn, ids] of idsByNormalizedIsbn.entries()) {
    const cover = coverByIsbn.get(isbn);
    if (!cover) continue;
    for (const id of ids) {
      updates.push({ id, cover });
    }
  }

  const updateCoverById = db.prepare(
    "UPDATE books SET thumbnail_url = ? WHERE id = ? AND (thumbnail_url IS NULL OR trim(thumbnail_url) = '')"
  );
  const applyUpdates = db.transaction((rows) => {
    let booksUpdated = 0;
    for (const row of rows) {
      const result = updateCoverById.run(row.cover, row.id);
      booksUpdated += Number(result.changes || 0);
    }
    return booksUpdated;
  });
  const booksUpdated = applyUpdates(updates);

  return {
    candidates: candidates.length,
    isbnCandidates: idsByNormalizedIsbn.size,
    isbnResolved: coverByIsbn.size,
    booksUpdated,
    enrichmentEnabled: true
  };
}

function backfillThriftBooksResourcesForExistingBooks() {
  const candidates = db
    .prepare(
      `
      SELECT id, isbn, resources_json AS resourcesJson
      FROM books
      WHERE isbn IS NOT NULL
        AND trim(isbn) != ''
    `
    )
    .all();

  const updateResourcesById = db.prepare("UPDATE books SET resources_json = ? WHERE id = ?");
  const applyUpdates = db.transaction((rows) => {
    let booksUpdated = 0;
    for (const row of rows) {
      const normalizedIsbn = normalizeIsbn(row.isbn);
      if (!normalizedIsbn) continue;

      const existingResources = parseResourcesJson(row.resourcesJson);
      const mergedResources = upsertThriftBooksResource(existingResources, normalizedIsbn);
      if (!mergedResources) continue;

      const hasChanged =
        JSON.stringify(existingResources) !== JSON.stringify(mergedResources);
      if (!hasChanged) continue;

      const result = updateResourcesById.run(JSON.stringify(mergedResources), row.id);
      booksUpdated += Number(result.changes || 0);
    }
    return booksUpdated;
  });

  const booksUpdated = applyUpdates(candidates);
  return {
    candidates: candidates.length,
    booksUpdated
  };
}

function normalizeFieldName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getRowField(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && row[alias] !== "") {
      return row[alias];
    }
  }

  const normalizedAliases = aliases.map((alias) => normalizeFieldName(alias));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeFieldName(key)) && value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function parseResourcesFromRow(row, rowIndex) {
  const resources = [];
  const pushResource = (label, rawUrl) => {
    const normalizedUrl = coerceHttpUrl(rawUrl);
    if (!normalizedUrl) return;
    resources.push({ label, url: normalizedUrl });
  };

  const embeddedResources = getRowField(row, ["resources", "Resources"]);
  if (embeddedResources !== undefined) {
    let parsedEmbeddedResources = embeddedResources;
    if (typeof embeddedResources === "string") {
      const trimmed = embeddedResources.trim();
      if (trimmed) {
        try {
          parsedEmbeddedResources = JSON.parse(trimmed);
        } catch {
          throw new Error(`Invalid row ${rowIndex}: resources must be valid JSON when provided as text.`);
        }
      } else {
        parsedEmbeddedResources = [];
      }
    }

    if (!Array.isArray(parsedEmbeddedResources)) {
      throw new Error(`Invalid row ${rowIndex}: resources must be an array.`);
    }

    for (const [index, resource] of parsedEmbeddedResources.entries()) {
      if (!resource || typeof resource !== "object") {
        throw new Error(`Invalid row ${rowIndex}: resource ${index + 1} must be an object.`);
      }
      const label = String(resource.label ?? resource.name ?? `Resource ${index + 1}`).trim();
      pushResource(label || `Resource ${index + 1}`, resource.url ?? resource.link);
    }
  }

  const storefrontColumns = [
    { label: "Amazon", aliases: ["amazonUrl", "amazon_url", "amazon"] },
    { label: "Bookshop", aliases: ["bookshopUrl", "bookshop_url", "bookshop"] },
    {
      label: "Barnes & Noble",
      aliases: ["barnesAndNobleUrl", "barnes_and_noble_url", "bnUrl", "bn_url"]
    },
    { label: "IndieBound", aliases: ["indieBoundUrl", "indiebound_url", "indiebound"] },
    { label: "ThriftBooks", aliases: ["thriftbooksUrl", "thriftbooks_url", "thriftbooks"] }
  ];
  for (const storefront of storefrontColumns) {
    pushResource(storefront.label, getRowField(row, storefront.aliases));
  }

  for (let index = 1; index <= 3; index += 1) {
    const label = String(
      getRowField(row, [`resource${index}Label`, `resource_${index}_label`]) || `Resource ${index}`
    ).trim();
    pushResource(label, getRowField(row, [`resource${index}Url`, `resource_${index}_url`]));
  }

  const deduped = [];
  const seen = new Set();
  for (const resource of resources) {
    const key = `${resource.label.toLowerCase()}|${resource.url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(resource);
  }
  return deduped.length > 0 ? deduped : undefined;
}

function parseResourcesJson(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({ label: String(item.label || "").trim(), url: String(item.url || "").trim() }))
      .filter((item) => item.label && item.url);
  } catch {
    return [];
  }
}

function parseReadingListRows(fileBuffer, fileName, mimeType, defaultVolume) {
  const isJsonFile =
    mimeType?.includes("application/json") || fileName.toLowerCase().endsWith(".json");

  let rawRows;
  if (isJsonFile) {
    const json = JSON.parse(fileBuffer.toString("utf8"));
    rawRows = Array.isArray(json) ? json : json.rows;
  } else {
    rawRows = parseCsv(fileBuffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  }

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error("Reading list file is empty.");
  }
  if (rawRows.length > 1000) {
    throw new Error("Reading list file is too large. Maximum 1000 rows.");
  }

  return rawRows.map((row, index) => {
    const rawYear = parseOptionalNumber(getRowField(row, ["year", "Year"]));
    const explicitVolume = parseOptionalNumber(
      getRowField(row, ["volume", "Volume", "season", "Season"])
    );
    const meetingStartsAt = parseOptionalDateTime(
      getRowField(row, [
        "meetingStartsAt",
        "meeting_starts_at",
        "meetingDate",
        "meeting_date",
        "meetingDateTime",
        "meeting_datetime"
      ])
    );
    if (meetingStartsAt === null) {
      throw new Error(`Invalid row ${index + 1}: meeting date must be a valid date/time.`);
    }

    let rawVolume = explicitVolume;
    if (rawVolume === undefined && defaultVolume !== undefined) {
      rawVolume = Number(defaultVolume);
    }
    if (rawVolume === undefined) {
      throw new Error(
        `Invalid row ${index + 1}: volume is required (add a volume column or choose a volume in the Admin form).`
      );
    }

    const normalizedYear =
      rawYear === undefined
        ? rawVolume !== undefined
          ? volumeToLegacyYear(Number(rawVolume))
          : undefined
        : Number(rawYear);
    const candidate = {
      volume: rawVolume,
      year: normalizedYear,
      title: getRowField(row, ["title", "Title"]),
      author: getRowField(row, ["author", "Author"]),
      isbn: normalizeIsbn(getRowField(row, ["isbn", "ISBN"])),
      month: getRowField(row, ["month", "Month"]),
      meetingStartsAt,
      meetingLocation: getRowField(row, ["meetingLocation", "meeting_location", "location"]),
      thumbnailUrl: coerceHttpUrl(
        getRowField(row, ["thumbnailUrl", "thumbnail_url", "thumbnail", "coverImage", "cover_image"])
      ),
      resources: parseResourcesFromRow(row, index + 1),
      isFeatured: parseBooleanLike(getRowField(row, ["isFeatured", "is_featured", "IsFeatured"]))
    };
    const parsed = readingListRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message || "Invalid row.";
      throw new Error(`Invalid row ${index + 1}: ${detail}`);
    }
    return parsed.data;
  });
}

function applyReadingListToAllUsers(rows, mode) {
  const users = db.prepare("SELECT id FROM users").all();
  const volumes = [...new Set(rows.map((row) => row.volume))];

  const deleteVolumeBooks = db.prepare("DELETE FROM books WHERE user_id = ? AND volume = ?");
  const clearFeaturedForVolume = db.prepare(
    "UPDATE books SET is_featured = 0 WHERE user_id = ? AND volume = ?"
  );
  const findExistingBook = db.prepare(
    `
      SELECT id
      FROM books
      WHERE user_id = ? AND volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      LIMIT 1
    `
  );
  const insertBook = db.prepare(
    `
      INSERT INTO books (
        id,
        user_id,
        year,
        volume,
        title,
        author,
        isbn,
        month,
        meeting_starts_at,
        meeting_location,
        thumbnail_url,
        featured_image_url,
        resources_json,
        is_featured,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const updateBook = db.prepare(
    `
      UPDATE books
      SET
        month = ?,
        meeting_starts_at = COALESCE(?, meeting_starts_at),
        meeting_location = COALESCE(?, meeting_location),
        thumbnail_url = COALESCE(?, thumbnail_url),
        featured_image_url = COALESCE(?, featured_image_url),
        resources_json = COALESCE(?, resources_json),
        isbn = COALESCE(?, isbn),
        is_featured = ?,
        year = ?,
        volume = ?
      WHERE id = ? AND user_id = ?
    `
  );

  const applyTransaction = db.transaction(() => {
    let booksInserted = 0;
    let booksUpdated = 0;

    for (const user of users) {
      if (mode === "replace") {
        for (const volume of volumes) {
          deleteVolumeBooks.run(user.id, volume);
        }
      }

      for (const row of rows) {
        if (row.isFeatured) {
          clearFeaturedForVolume.run(user.id, row.volume);
        }

        const existing = findExistingBook.get(user.id, row.volume, row.title, row.author);
        if (existing) {
          updateBook.run(
            row.month,
            row.meetingStartsAt || null,
            row.meetingLocation || null,
            row.thumbnailUrl || null,
            row.featuredImageUrl || null,
            row.resources ? JSON.stringify(row.resources) : null,
            row.isbn || null,
            row.isFeatured ? 1 : 0,
            row.year ?? volumeToLegacyYear(row.volume),
            row.volume,
            existing.id,
            user.id
          );
          booksUpdated += 1;
          continue;
        }

        insertBook.run(
          randomUUID(),
          user.id,
          row.year ?? volumeToLegacyYear(row.volume),
          row.volume,
          row.title,
          row.author,
          row.isbn || null,
          row.month,
          row.meetingStartsAt || null,
          row.meetingLocation || null,
          row.thumbnailUrl || null,
          row.featuredImageUrl || null,
          JSON.stringify(row.resources || []),
          row.isFeatured ? 1 : 0,
          new Date().toISOString()
        );
        booksInserted += 1;
      }
    }

    return { usersAffected: users.length, rowsReceived: rows.length, booksInserted, booksUpdated };
  });

  return applyTransaction();
}

function clearVolumeForAllUsers(volume) {
  const clearTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksDeleted = db.prepare("SELECT COUNT(*) AS count FROM books WHERE volume = ?").get(volume).count;
    db.prepare("DELETE FROM books WHERE volume = ?").run(volume);
    return {
      volume,
      usersAffected,
      booksDeleted
    };
  });

  return clearTransaction();
}

function featureBookForAllUsers(requestUserId, referenceBookId) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const unfeatured = db
      .prepare("UPDATE books SET is_featured = 0 WHERE volume = ?")
      .run(referenceBook.volume).changes;
    const featured = db
      .prepare(
        `
        UPDATE books
        SET is_featured = 1
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(referenceBook.volume, referenceBook.title, referenceBook.author).changes;

    return {
      usersAffected,
      booksUnfeatured: unfeatured,
      booksFeatured: featured,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author
    };
  });

  return applyTransaction();
}

function assignMeetingForBookForAllUsers(requestUserId, referenceBookId, startsAt, location) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  const meetingStartsAt = new Date(startsAt).toISOString();
  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksUpdated = db
      .prepare(
        `
        UPDATE books
        SET meeting_starts_at = ?, meeting_location = ?
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(
        meetingStartsAt,
        location,
        referenceBook.volume,
        referenceBook.title,
        referenceBook.author
      ).changes;

    return {
      usersAffected,
      booksUpdated,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author,
      meetingStartsAt,
      meetingLocation: location
    };
  });

  return applyTransaction();
}

function clearMeetingForBookForAllUsers(requestUserId, referenceBookId) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksUpdated = db
      .prepare(
        `
        UPDATE books
        SET meeting_starts_at = NULL, meeting_location = NULL
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(referenceBook.volume, referenceBook.title, referenceBook.author).changes;

    return {
      usersAffected,
      booksUpdated,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author
    };
  });

  return applyTransaction();
}

async function updateIsbnForBookForAllUsers(requestUserId, referenceBookId, isbnInput) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  const normalizedIsbn = normalizeIsbn(isbnInput);
  if (isbnInput !== undefined && isbnInput !== null && String(isbnInput).trim() !== "" && !normalizedIsbn) {
    return { error: "ISBN must be a valid ISBN-10 or ISBN-13." };
  }
  const nextIsbn = normalizedIsbn || null;
  const resolvedCover = nextIsbn ? await resolveCoverForIsbn(nextIsbn) : null;
  const thriftBooksUrl = nextIsbn ? buildThriftBooksIsbnLookupUrl(nextIsbn) : null;

  const selectMatchingBookResources = db.prepare(
    `
      SELECT id, resources_json AS resourcesJson
      FROM books
      WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
    `
  );
  const updateResourcesById = db.prepare("UPDATE books SET resources_json = ? WHERE id = ?");

  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksUpdated = db
      .prepare(
        `
        UPDATE books
        SET isbn = ?
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(nextIsbn, referenceBook.volume, referenceBook.title, referenceBook.author).changes;
    let coversUpdated = 0;
    let resourcesUpdated = 0;
    if (nextIsbn && COVER_ENRICHMENT_ENABLED) {
      coversUpdated = db
        .prepare(
          `
          UPDATE books
          SET thumbnail_url = ?
          WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
        `
        )
        .run(resolvedCover, referenceBook.volume, referenceBook.title, referenceBook.author).changes;
    }

    const matchingBooks = selectMatchingBookResources.all(
      referenceBook.volume,
      referenceBook.title,
      referenceBook.author
    );
    for (const book of matchingBooks) {
      const existingResources = parseResourcesJson(book.resourcesJson);
      const nextResources = nextIsbn
        ? upsertThriftBooksResource(existingResources, nextIsbn) || []
        : removeThriftBooksResource(existingResources);
      if (JSON.stringify(existingResources) === JSON.stringify(nextResources)) continue;
      const result = updateResourcesById.run(JSON.stringify(nextResources), book.id);
      resourcesUpdated += Number(result.changes || 0);
    }

    return {
      usersAffected,
      booksUpdated,
      coversUpdated,
      resourcesUpdated,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author,
      isbn: nextIsbn,
      thriftBooksUrl,
      coverUrl: resolvedCover,
      coverResolved: Boolean(resolvedCover),
      coverSyncAttempted: Boolean(nextIsbn && COVER_ENRICHMENT_ENABLED)
    };
  });

  return applyTransaction();
}

function updateThumbnailForBookForAllUsers(requestUserId, referenceBookId, thumbnailInput) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  let nextThumbnail = null;
  if (thumbnailInput !== undefined && thumbnailInput !== null && String(thumbnailInput).trim() !== "") {
    nextThumbnail = coerceHttpUrl(thumbnailInput);
    const parsed = bookThumbnailSchema.safeParse({ thumbnailUrl: nextThumbnail });
    if (!parsed.success) {
      return { error: "Cover image URL must be a valid URL." };
    }
    nextThumbnail = parsed.data.thumbnailUrl;
  }

  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksUpdated = db
      .prepare(
        `
        UPDATE books
        SET thumbnail_url = ?
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(nextThumbnail, referenceBook.volume, referenceBook.title, referenceBook.author).changes;

    return {
      usersAffected,
      booksUpdated,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author,
      thumbnailUrl: nextThumbnail
    };
  });

  return applyTransaction();
}

function updateFeaturedImageForBookForAllUsers(requestUserId, referenceBookId, featuredImageUrl) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  const previous = db
    .prepare(
      `
      SELECT featured_image_url AS featuredImageUrl
      FROM books
      WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?) AND featured_image_url IS NOT NULL
      LIMIT 1
    `
    )
    .get(referenceBook.volume, referenceBook.title, referenceBook.author);

  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksUpdated = db
      .prepare(
        `
        UPDATE books
        SET featured_image_url = ?
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(featuredImageUrl || null, referenceBook.volume, referenceBook.title, referenceBook.author).changes;

    return {
      usersAffected,
      booksUpdated,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author,
      featuredImageUrl: featuredImageUrl || null,
      previousFeaturedImageUrl: previous?.featuredImageUrl || null
    };
  });

  return applyTransaction();
}

function deleteBookForAllUsers(requestUserId, referenceBookId) {
  const referenceBook = db
    .prepare(
      `
      SELECT id, title, author, volume
      FROM books
      WHERE id = ? AND user_id = ?
    `
    )
    .get(referenceBookId, requestUserId);
  if (!referenceBook) {
    return null;
  }

  const featuredImageUrls = db
    .prepare(
      `
      SELECT DISTINCT featured_image_url AS featuredImageUrl
      FROM books
      WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?) AND featured_image_url IS NOT NULL
    `
    )
    .all(referenceBook.volume, referenceBook.title, referenceBook.author)
    .map((row) => row.featuredImageUrl)
    .filter(Boolean);

  const applyTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksDeleted = db
      .prepare(
        `
        DELETE FROM books
        WHERE volume = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      `
      )
      .run(referenceBook.volume, referenceBook.title, referenceBook.author).changes;

    return {
      usersAffected,
      booksDeleted,
      volume: referenceBook.volume,
      title: referenceBook.title,
      author: referenceBook.author,
      featuredImageUrls
    };
  });

  return applyTransaction();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid registration data." });
  }

  const { name, email, password } = parsed.data;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    "INSERT INTO users (name, email, password_hash, role, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );

  try {
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const role =
      userCount === 0 || (ADMIN_EMAIL && ADMIN_EMAIL === email) ? "admin" : ALLOWED_ROLES[0];
    const isApproved = role === "admin";
    const result = insertUser.run(name, email, passwordHash, role, isApproved ? 1 : 0, now);
    const userId = Number(result.lastInsertRowid);
    seedBooksForUser(userId);
    const user = db
      .prepare(
        "SELECT id, name, email, role, is_approved AS isApproved, profile_image_url AS profileImageUrl FROM users WHERE id = ?"
      )
      .get(userId);
    if (!isApproved) {
      return res.status(201).json({
        requiresApproval: true,
        message: "Account created. An admin must approve your account before you can sign in."
      });
    }
    const token = createSessionToken(user);
    setSessionCookie(res, token);
    return res.status(201).json({ user: formatUser(user) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    return res.status(500).json({ error: "Failed to create account." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { email, password } = parsed.data;
  let user = db
    .prepare(
      "SELECT id, name, email, role, is_approved AS isApproved, profile_image_url AS profileImageUrl, password_hash AS passwordHash FROM users WHERE email = ?"
    )
    .get(email);

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const validPassword = await argon2.verify(user.passwordHash, password);
  if (!validPassword) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  user = syncAdminRoleForConfiguredEmail(user);
  if (!Boolean(user.isApproved)) {
    clearSessionCookie(res);
    return res.status(403).json({ error: "Your account is pending admin approval." });
  }
  const token = createSessionToken(user);
  setSessionCookie(res, token);
  return res.json({ user: formatUser(user) });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  let user = db
    .prepare(
      "SELECT id, name, email, role, is_approved AS isApproved, profile_image_url AS profileImageUrl FROM users WHERE id = ?"
    )
    .get(req.userId);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
  user = syncAdminRoleForConfiguredEmail(user);
  return res.json({ user: formatUser(user) });
});

app.get(
  "/api/admin/users/pending",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (_req, res) => {
    const users = db
      .prepare(
        `
        SELECT id, name, email, created_at AS createdAt
        FROM users
        WHERE is_approved = 0
        ORDER BY created_at ASC
      `
      )
      .all();
    return res.json({ users });
  }
);

app.post(
  "/api/admin/users/:userId/approve",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = pendingUserIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const user = db
      .prepare("SELECT id, name, email, role, is_approved AS isApproved FROM users WHERE id = ?")
      .get(parsed.data.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    db.prepare("UPDATE users SET is_approved = 1 WHERE id = ?").run(parsed.data.userId);
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: true
      }
    });
  }
);

app.post(
  "/api/admin/users/:userId/deny",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = pendingUserIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const user = db
      .prepare("SELECT id, name, email, role, is_approved AS isApproved FROM users WHERE id = ?")
      .get(parsed.data.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    if (Boolean(user.isApproved)) {
      return res.status(400).json({ error: "Only pending users can be denied." });
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(parsed.data.userId);
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  }
);

app.post(
  "/api/admin/users/:userId/promote",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = pendingUserIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const user = db
      .prepare("SELECT id, name, email, role, is_approved AS isApproved FROM users WHERE id = ?")
      .get(parsed.data.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    if (!Boolean(user.isApproved)) {
      return res.status(400).json({ error: "Approve this account before granting admin access." });
    }

    if (user.role !== "admin") {
      db.prepare("UPDATE users SET role = 'admin', is_approved = 1 WHERE id = ?").run(parsed.data.userId);
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: "admin",
        isApproved: true
      }
    });
  }
);

app.get(
  "/api/admin/settings/featured-image-fallbacks",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (_req, res) => {
    return res.json({ urls: getFeaturedImageFallbackUrls() });
  }
);

app.put(
  "/api/admin/settings/featured-image-fallbacks",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = featuredImageFallbackSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || "Invalid fallback image URL data."
      });
    }

    const previousUrls = getFeaturedImageFallbackUrls();
    const urls = saveFeaturedImageFallbackUrls(parsed.data.urls);
    const removedUrls = previousUrls.filter((url) => !urls.includes(url));
    for (const removedUrl of removedUrls) {
      removeStoredFeaturedImageIfUnused(removedUrl);
    }
    return res.json({ urls });
  }
);

app.post(
  "/api/admin/settings/featured-image-fallbacks/upload",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  featuredImageUpload.array("files", FEATURED_IMAGE_FALLBACK_LIMIT),
  (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: "Select one or more image files to upload." });
    }

    const existingUrls = getFeaturedImageFallbackUrls();
    if (existingUrls.length + files.length > FEATURED_IMAGE_FALLBACK_LIMIT) {
      return res.status(400).json({
        error: `You can store up to ${FEATURED_IMAGE_FALLBACK_LIMIT} fallback images. Remove one before uploading more.`
      });
    }
    const fileExtensions = files.map((file) => resolveImageExtension(file, getFeaturedImageExtension));
    if (fileExtensions.some((extension) => !extension)) {
      return res.status(400).json({ error: "Fallback images must be valid JPG, PNG, WEBP, or GIF files." });
    }

    const stagedUploads = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const extension = fileExtensions[index];
        const fileName = `fallback-${req.userId}-${randomUUID()}.${extension}`;
        const filePath = path.join(FEATURED_IMAGES_DIR, fileName);
        writeFileSync(filePath, file.buffer);
        stagedUploads.push(`/api/uploads/featured-images/${fileName}`);
      }

      const urls = saveFeaturedImageFallbackUrls([...existingUrls, ...stagedUploads]);
      return res.status(201).json({ urls, uploaded: stagedUploads.length });
    } catch {
      for (const stagedUrl of stagedUploads) {
        removeStoredFeaturedImageIfUnused(stagedUrl);
      }
      return res.status(500).json({ error: "Failed to upload fallback image(s)." });
    }
  }
);

app.delete(
  "/api/admin/settings/featured-image-fallbacks",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = featuredImageFallbackDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || "A valid fallback image URL is required."
      });
    }

    const normalizedUrl = normalizeHttpOrRootRelativeUrl(parsed.data.url);
    if (!normalizedUrl) {
      return res.status(400).json({ error: "A valid fallback image URL is required." });
    }

    const existingUrls = getFeaturedImageFallbackUrls();
    if (!existingUrls.includes(normalizedUrl)) {
      return res.status(404).json({ error: "Fallback image not found." });
    }

    const urls = saveFeaturedImageFallbackUrls(
      existingUrls.filter((existingUrl) => existingUrl !== normalizedUrl)
    );
    removeStoredFeaturedImageIfUnused(normalizedUrl);
    return res.json({ urls });
  }
);

app.get("/api/books", requireAuth, (req, res) => {
  const payload = getBooksPayload(req.userId);
  res.json(payload);
});

app.put("/api/books/:bookId/completion", requireAuth, (req, res) => {
  const parsedParams = featureBookParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid book id." });
  }
  const parsedBody = completionSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Completion state must be true or false." });
  }

  const exists = db
    .prepare("SELECT id FROM books WHERE id = ? AND user_id = ?")
    .get(parsedParams.data.bookId, req.userId);
  if (!exists) {
    return res.status(404).json({ error: "Book not found." });
  }

  const completedAt = parsedBody.data.completed ? new Date().toISOString() : null;
  if (parsedBody.data.completed) {
    db.prepare("UPDATE books SET is_completed = 1, completed_at = ? WHERE id = ? AND user_id = ?").run(
      completedAt,
      parsedParams.data.bookId,
      req.userId
    );
  } else {
    db.prepare(
      "UPDATE books SET is_completed = 0, completed_at = NULL, rating = NULL, rated_at = NULL WHERE id = ? AND user_id = ?"
    ).run(parsedParams.data.bookId, req.userId);
  }

  return res.json({
    completion: {
      bookId: parsedParams.data.bookId,
      isCompleted: parsedBody.data.completed,
      completedAt
    }
  });
});

app.put("/api/books/:bookId/rating", requireAuth, (req, res) => {
  const parsedParams = featureBookParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid book id." });
  }
  const parsedBody = ratingSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Rating must be an integer from 1 to 5." });
  }

  const book = db
    .prepare("SELECT id, is_completed AS isCompleted FROM books WHERE id = ? AND user_id = ?")
    .get(parsedParams.data.bookId, req.userId);
  if (!book) {
    return res.status(404).json({ error: "Book not found." });
  }
  if (!Boolean(book.isCompleted)) {
    return res.status(400).json({ error: "Complete the book before leaving a rating." });
  }

  const ratedAt = new Date().toISOString();
  db.prepare("UPDATE books SET rating = ?, rated_at = ? WHERE id = ? AND user_id = ?").run(
    parsedBody.data.rating,
    ratedAt,
    parsedParams.data.bookId,
    req.userId
  );

  return res.json({
    rating: {
      bookId: parsedParams.data.bookId,
      value: parsedBody.data.rating,
      ratedAt
    }
  });
});

app.delete("/api/books/:bookId/rating", requireAuth, (req, res) => {
  const parsedParams = featureBookParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid book id." });
  }

  const exists = db
    .prepare("SELECT id FROM books WHERE id = ? AND user_id = ?")
    .get(parsedParams.data.bookId, req.userId);
  if (!exists) {
    return res.status(404).json({ error: "Book not found." });
  }

  db.prepare("UPDATE books SET rating = NULL, rated_at = NULL WHERE id = ? AND user_id = ?").run(
    parsedParams.data.bookId,
    req.userId
  );
  return res.status(204).end();
});

app.get("/api/dashboard", requireAuth, (_req, res) => {
  const payload = getDashboardPayload();
  return res.json(payload);
});

app.get("/api/members/:memberId", requireAuth, (req, res) => {
  const parsed = memberParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid member id." });
  }

  const payload = getMemberProfilePayload(parsed.data.memberId, req.userId);
  if (!payload) {
    return res.status(404).json({ error: "Member not found." });
  }
  return res.json(payload);
});

app.put("/api/users/me/profile", requireAuth, authLimiter, (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid profile data." });
  }

  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(parsed.data.name, req.userId);

  const user = db
    .prepare(
      "SELECT id, name, email, role, is_approved AS isApproved, profile_image_url AS profileImageUrl FROM users WHERE id = ?"
    )
    .get(req.userId);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json({ user: formatUser(user) });
});

app.post(
  "/api/users/me/profile-image",
  requireAuth,
  authLimiter,
  profileImageUpload.single("file"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Select an image file to upload." });
    }

    const extension = resolveImageExtension(req.file, getProfileImageExtension);
    if (!extension) {
      return res.status(400).json({ error: "Profile image must be a valid JPG, PNG, WEBP, or GIF file." });
    }

    const previous = db
      .prepare("SELECT profile_image_url AS profileImageUrl FROM users WHERE id = ?")
      .get(req.userId);
    if (!previous) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const fileName = `${req.userId}-${randomUUID()}.${extension}`;
    const filePath = path.join(PROFILE_IMAGES_DIR, fileName);
    writeFileSync(filePath, req.file.buffer);
    const profileImageUrl = `/api/uploads/profile-images/${fileName}`;

    db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(profileImageUrl, req.userId);
    removeStoredProfileImage(previous.profileImageUrl);

    const user = db
      .prepare(
        "SELECT id, name, email, role, is_approved AS isApproved, profile_image_url AS profileImageUrl FROM users WHERE id = ?"
      )
      .get(req.userId);
    return res.json({ user: formatUser(user) });
  }
);

app.delete("/api/users/me/profile-image", requireAuth, authLimiter, (req, res) => {
  const user = db
    .prepare(
      "SELECT id, name, email, role, is_approved AS isApproved, profile_image_url AS profileImageUrl FROM users WHERE id = ?"
    )
    .get(req.userId);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  db.prepare("UPDATE users SET profile_image_url = NULL WHERE id = ?").run(req.userId);
  removeStoredProfileImage(user.profileImageUrl);
  return res.json({ user: formatUser({ ...user, profileImageUrl: null }) });
});

app.post("/api/books/:bookId/comments", requireAuth, (req, res) => {
  const parsedParams = featureBookParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid book id." });
  }
  const { bookId } = parsedParams.data;
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Comment cannot be empty." });
  }

  const userBook = db
    .prepare("SELECT id FROM books WHERE id = ? AND user_id = ?")
    .get(bookId, req.userId);

  if (!userBook) {
    return res.status(404).json({ error: "Book not found." });
  }

  const rootBook = db
    .prepare("SELECT id, volume, title, author FROM books WHERE id = ?")
    .get(bookId);
  if (!rootBook) {
    return res.status(404).json({ error: "Book not found." });
  }

  let parentCommentId = parsed.data.parentCommentId || null;
  if (parentCommentId) {
    const parent = db
      .prepare(
        `
        SELECT c.id, b.volume, b.title, b.author
        FROM comments c
        INNER JOIN books b ON b.id = c.book_id
        WHERE c.id = ?
      `
      )
      .get(parentCommentId);
    if (!parent || !hasSameBookIdentity(parent, rootBook)) {
      return res.status(400).json({ error: "Reply target not found for this book." });
    }
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const author = db.prepare("SELECT name FROM users WHERE id = ?").get(req.userId);
  const authorUserId = Number(req.userId);
  db.prepare(
    "INSERT INTO comments (id, user_id, book_id, parent_comment_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.userId, bookId, parentCommentId, parsed.data.text, createdAt);

  return res.status(201).json({
    comment: {
      id,
      text: parsed.data.text,
      authorName: author?.name || "Unknown",
      authorUserId,
      parentCommentId,
      createdAt,
      likesCount: 0,
      isLikedByUser: false
    }
  });
});

app.delete("/api/books/:bookId/comments/:commentId", requireAuth, (req, res) => {
  const parsedParams = commentParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid comment id." });
  }
  const { bookId, commentId } = parsedParams.data;

  const rootBook = db
    .prepare("SELECT id, volume, title, author FROM books WHERE id = ? AND user_id = ?")
    .get(bookId, req.userId);
  if (!rootBook) {
    return res.status(404).json({ error: "Book not found." });
  }

  const comment = db
    .prepare(
      `
      SELECT c.id, c.user_id AS authorUserId, b.volume, b.title, b.author
      FROM comments c
      INNER JOIN books b ON b.id = c.book_id
      WHERE c.id = ?
    `
    )
    .get(commentId);
  if (!comment || !hasSameBookIdentity(comment, rootBook)) {
    return res.status(404).json({ error: "Comment not found." });
  }

  const actor = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.userId);
  if (!actor) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
  const isAdmin = actor.role === "admin";
  if (!isAdmin && Number(comment.authorUserId) !== Number(req.userId)) {
    return res.status(403).json({ error: "You can only delete your own comments." });
  }

  db.prepare(
    `
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM comments WHERE id = ?
      UNION ALL
      SELECT c.id
      FROM comments c
      INNER JOIN descendants d ON c.parent_comment_id = d.id
    )
    DELETE FROM comments
    WHERE id IN (SELECT id FROM descendants)
  `
  ).run(commentId);

  return res.status(204).end();
});

app.put("/api/books/:bookId/comments/:commentId/like", requireAuth, (req, res) => {
  const parsedParams = commentParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid comment id." });
  }
  const parsedBody = commentLikeSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid like state." });
  }

  const { bookId, commentId } = parsedParams.data;
  const rootBook = db
    .prepare("SELECT id, volume, title, author FROM books WHERE id = ? AND user_id = ?")
    .get(bookId, req.userId);
  if (!rootBook) {
    return res.status(404).json({ error: "Book not found." });
  }

  const comment = db
    .prepare(
      `
      SELECT c.id, b.volume, b.title, b.author
      FROM comments c
      INNER JOIN books b ON b.id = c.book_id
      WHERE c.id = ?
    `
    )
    .get(commentId);
  if (!comment || !hasSameBookIdentity(comment, rootBook)) {
    return res.status(404).json({ error: "Comment not found." });
  }

  if (parsedBody.data.liked) {
    db.prepare(
      `
      INSERT INTO comment_likes (user_id, comment_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, comment_id) DO NOTHING
    `
    ).run(req.userId, commentId, new Date().toISOString());
  } else {
    db.prepare("DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?").run(req.userId, commentId);
  }

  return res.json({ commentId, ...getCommentLikeSummary(commentId, req.userId) });
});

app.post(
  "/api/admin/books/:bookId/feature",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = featureBookParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }

    const summary = featureBookForAllUsers(req.userId, parsed.data.bookId);
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }

    return res.json({
      summary,
      book: {
        title: summary.title,
        author: summary.author,
        volume: summary.volume
      }
    });
  }
);

app.delete(
  "/api/admin/books/:bookId",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = featureBookParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }

    const summary = deleteBookForAllUsers(req.userId, parsed.data.bookId);
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }

    for (const imageUrl of summary.featuredImageUrls || []) {
      removeStoredFeaturedImageIfUnused(imageUrl);
    }

    return res.json({ summary });
  }
);

app.put(
  "/api/admin/books/:bookId/meeting",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsedParams = featureBookParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }
    const parsedBody = bookMeetingSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.issues[0]?.message || "Invalid meeting data." });
    }

    const summary = assignMeetingForBookForAllUsers(
      req.userId,
      parsedParams.data.bookId,
      parsedBody.data.startsAt,
      parsedBody.data.location
    );
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }

    return res.json({ summary });
  }
);

app.delete(
  "/api/admin/books/:bookId/meeting",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = featureBookParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }

    const summary = clearMeetingForBookForAllUsers(req.userId, parsed.data.bookId);
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }

    return res.status(204).end();
  }
);

app.put(
  "/api/admin/books/:bookId/isbn",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  async (req, res) => {
    const parsedParams = featureBookParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }

    const parsedBody = bookIsbnSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "Invalid ISBN data." });
    }

    const summary = await updateIsbnForBookForAllUsers(
      req.userId,
      parsedParams.data.bookId,
      parsedBody.data.isbn
    );
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }
    if (summary.error) {
      return res.status(400).json({ error: summary.error });
    }

    return res.json({ summary });
  }
);

app.put(
  "/api/admin/books/:bookId/thumbnail",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsedParams = featureBookParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }

    const parsedBody = bookThumbnailSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "Invalid cover image data." });
    }

    const summary = updateThumbnailForBookForAllUsers(
      req.userId,
      parsedParams.data.bookId,
      parsedBody.data.thumbnailUrl
    );
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }
    if (summary.error) {
      return res.status(400).json({ error: summary.error });
    }

    return res.json({ summary });
  }
);

app.post(
  "/api/admin/reading-list/isbn-lookup",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  async (req, res) => {
    const parsed = isbnLookupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "ISBN is required." });
    }

    const normalizedIsbn = normalizeIsbn(parsed.data.isbn);
    if (!normalizedIsbn) {
      return res.status(400).json({ error: "ISBN must be a valid ISBN-10 or ISBN-13." });
    }

    const book = await lookupBookByIsbn(normalizedIsbn);
    if (!book) {
      return res.status(404).json({ error: "No matching book found for that ISBN." });
    }

    return res.json({ book });
  }
);

app.post(
  "/api/admin/reading-list/record",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  async (req, res) => {
    const parsed = singleRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid record data." });
    }

    const row = {
      volume: parsed.data.volume,
      title: parsed.data.title,
      author: parsed.data.author,
      month: parsed.data.month,
      year: parsed.data.year,
      isbn: parsed.data.isbn,
      thumbnailUrl: parsed.data.thumbnailUrl,
      featuredImageUrl: parsed.data.featuredImageUrl,
      meetingStartsAt: undefined,
      meetingLocation: undefined,
      resources: undefined,
      isFeatured: false
    };

    const [enrichedRow] = await enrichRowsWithCovers([row]);
    const summary = applyReadingListToAllUsers([enrichedRow], parsed.data.mode);
    db.prepare(
      `
      INSERT INTO reading_list_uploads (id, admin_user_id, filename, mode, rows_imported, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      randomUUID(),
      req.userId,
      "single-record",
      parsed.data.mode,
      1,
      new Date().toISOString()
    );

    return res.status(201).json({ summary });
  }
);

app.post(
  "/api/admin/books/:bookId/featured-image",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  featuredImageUpload.single("file"),
  (req, res) => {
    const parsedParams = featureBookParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Select an image file to upload." });
    }

    const extension = resolveImageExtension(req.file, getFeaturedImageExtension);
    if (!extension) {
      return res.status(400).json({ error: "Featured image must be a valid JPG, PNG, WEBP, or GIF file." });
    }

    const fileName = `featured-${req.userId}-${randomUUID()}.${extension}`;
    const filePath = path.join(FEATURED_IMAGES_DIR, fileName);
    const featuredImageUrl = `/api/uploads/featured-images/${fileName}`;
    writeFileSync(filePath, req.file.buffer);

    const summary = updateFeaturedImageForBookForAllUsers(
      req.userId,
      parsedParams.data.bookId,
      featuredImageUrl
    );
    if (!summary) {
      removeStoredFeaturedImageIfUnused(featuredImageUrl);
      return res.status(404).json({ error: "Book not found." });
    }

    if (summary.previousFeaturedImageUrl && summary.previousFeaturedImageUrl !== featuredImageUrl) {
      removeStoredFeaturedImageIfUnused(summary.previousFeaturedImageUrl);
    }

    return res.json({ summary });
  }
);

app.delete(
  "/api/admin/books/:bookId/featured-image",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsedParams = featureBookParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid book id." });
    }

    const summary = updateFeaturedImageForBookForAllUsers(req.userId, parsedParams.data.bookId, null);
    if (!summary) {
      return res.status(404).json({ error: "Book not found." });
    }

    if (summary.previousFeaturedImageUrl) {
      removeStoredFeaturedImageIfUnused(summary.previousFeaturedImageUrl);
    }
    return res.status(204).end();
  }
);

app.post(
  "/api/admin/reading-list/upload",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "A CSV or JSON file is required." });
    }

    const parsedMode = readingListModeSchema.safeParse(req.body?.mode || "append");
    if (!parsedMode.success) {
      return res.status(400).json({ error: "Mode must be append or replace." });
    }
    const parsedVolume = uploadVolumeSchema.safeParse(req.body?.volume ?? req.body?.season);
    if (!parsedVolume.success) {
      return res.status(400).json({ error: "Volume must be between 1 and 99." });
    }

    try {
      const rows = parseReadingListRows(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        parsedVolume.data
      );
      const enrichedRows = await enrichRowsWithCovers(rows);
      const summary = applyReadingListToAllUsers(enrichedRows, parsedMode.data);

      db.prepare(
        `
        INSERT INTO reading_list_uploads (id, admin_user_id, filename, mode, rows_imported, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        randomUUID(),
        req.userId,
        req.file.originalname,
        parsedMode.data,
        rows.length,
        new Date().toISOString()
      );

      return res.status(201).json({ summary });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid reading list file." });
    }
  }
);

app.post(
  "/api/admin/reading-list/clear-volume",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = clearVolumeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Volume must be between 1 and 99." });
    }

    const summary = clearVolumeForAllUsers(parsed.data.volume);
    db.prepare(
      `
      INSERT INTO reading_list_uploads (id, admin_user_id, filename, mode, rows_imported, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      randomUUID(),
      req.userId,
      `clear-volume-${parsed.data.volume}`,
      "clear",
      summary.booksDeleted,
      new Date().toISOString()
    );

    return res.json({ summary });
  }
);

app.post(
  "/api/admin/reading-list/backfill-covers",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  async (req, res) => {
    try {
      const summary = await backfillMissingCoversForExistingBooks();
      db.prepare(
        `
        INSERT INTO reading_list_uploads (id, admin_user_id, filename, mode, rows_imported, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        randomUUID(),
        req.userId,
        "backfill-covers",
        "backfill",
        summary.booksUpdated,
        new Date().toISOString()
      );
      return res.json({ summary });
    } catch {
      return res.status(500).json({ error: "Failed to backfill covers." });
    }
  }
);

app.post(
  "/api/admin/reading-list/backfill-thriftbooks",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    try {
      const summary = backfillThriftBooksResourcesForExistingBooks();
      db.prepare(
        `
        INSERT INTO reading_list_uploads (id, admin_user_id, filename, mode, rows_imported, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        randomUUID(),
        req.userId,
        "backfill-thriftbooks",
        "backfill-thriftbooks",
        summary.booksUpdated,
        new Date().toISOString()
      );
      return res.json({ summary });
    } catch {
      return res.status(500).json({ error: "Failed to backfill ThriftBooks resources." });
    }
  }
);

app.get(
  "/api/admin/reading-list/uploads",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const uploads = db
      .prepare(
        `
        SELECT id, filename, mode, rows_imported AS rowsImported, created_at AS createdAt
        FROM reading_list_uploads
        ORDER BY created_at DESC
        LIMIT 20
      `
      )
      .all();
    res.json({ uploads });
  }
);

app.post(
  "/api/admin/reading-list/uploads/clear",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (_req, res) => {
    const clearTransaction = db.transaction(() => {
      const uploadsDeleted = db.prepare("SELECT COUNT(*) AS count FROM reading_list_uploads").get().count;
      db.prepare("DELETE FROM reading_list_uploads").run();
      return { uploadsDeleted };
    });

    const summary = clearTransaction();
    return res.json({ summary });
  }
);

app.use((error, _req, res, _next) => {
  if (error?.name === "MulterError" && error?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      error: `Uploaded file is too large. Maximum size is ${humanizeMegabytes(FEATURED_IMAGE_MAX_BYTES)}.`
    });
  }
  if (error?.name === "MulterError" && error?.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ error: "Unexpected upload field. Please retry using the upload button." });
  }
  if (String(error.message).includes("CORS")) {
    return res.status(403).json({ error: "CORS blocked for this origin." });
  }
  return res.status(500).json({ error: "Unexpected server error." });
});

async function startServer() {
  await ensureDevMemberAccount();
  const server = app.listen(PORT, () => {
    console.log(`API listening on http://127.0.0.1:${PORT}`);
    if (DEV_MEMBER_ACCOUNT_ENABLED) {
      console.log(`Dev member account ready: ${DEV_MEMBER_EMAIL}`);
    }
  });
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Stop the existing process or change PORT.`);
      process.exit(1);
    }
    console.error("Server failed to start:", error);
    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
