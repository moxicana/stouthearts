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
import { mkdirSync } from "node:fs";
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
const CURRENT_SEASON = Number(process.env.CURRENT_SEASON || 2);
const PAST_SEASON = Math.max(CURRENT_SEASON - 1, 1);
const ALLOWED_ROLES = ["member", "admin"];
const COVER_ENRICHMENT_ENABLED =
  String(process.env.COVER_ENRICHMENT_ENABLED || "true").trim().toLowerCase() !== "false";
const COVER_LOOKUP_TIMEOUT_MS = Math.max(500, Number(process.env.COVER_LOOKUP_TIMEOUT_MS || 3000));

if (JWT_SECRET === "dev-only-change-me") {
  console.warn(
    "Using fallback JWT secret. Set JWT_SECRET in .env before deploying to production."
  );
}

const DB_PATH = path.resolve("server", "data", "bookclub.db");
mkdirSync(path.dirname(DB_PATH), { recursive: true });
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  season INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT,
  month TEXT NOT NULL,
  thumbnail_url TEXT,
  resources_json TEXT NOT NULL DEFAULT '[]',
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  book_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
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
`);

ensureColumnExists("users", "role", "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
const addedSeasonColumn = ensureColumnExists(
  "books",
  "season",
  "ALTER TABLE books ADD COLUMN season INTEGER NOT NULL DEFAULT 1"
);
ensureColumnExists("books", "thumbnail_url", "ALTER TABLE books ADD COLUMN thumbnail_url TEXT");
ensureColumnExists(
  "books",
  "resources_json",
  "ALTER TABLE books ADD COLUMN resources_json TEXT NOT NULL DEFAULT '[]'"
);
ensureColumnExists("books", "isbn", "ALTER TABLE books ADD COLUMN isbn TEXT");
db.prepare(
  "UPDATE users SET role = 'member' WHERE role NOT IN ('member', 'admin') OR role IS NULL"
).run();
const BASE_LEGACY_YEAR = new Date().getFullYear() - (CURRENT_SEASON - 1);
if (addedSeasonColumn) {
  // One-time legacy backfill only when the season column is first introduced.
  db.prepare(
    `
    UPDATE books
    SET season = CASE
      WHEN year >= ? THEN year - ? + 1
      ELSE 1
    END
  `
  ).run(BASE_LEGACY_YEAR, BASE_LEGACY_YEAR);
}
db.prepare(
  `
  UPDATE books
  SET season = CASE
    WHEN year >= ? THEN year - ? + 1
    ELSE 1
  END
  WHERE season IS NULL OR season < 1
`
).run(BASE_LEGACY_YEAR, BASE_LEGACY_YEAR);
db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)");
db.exec("CREATE INDEX IF NOT EXISTS idx_books_user_season ON books(user_id, season)");

app.disable("x-powered-by");
app.use(helmet());
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 30 : 200,
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
  text: z.string().trim().min(1).max(400)
});

const readingListModeSchema = z.enum(["append", "replace"]);
const uploadSeasonSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  },
  z.number().int().min(1).max(99).optional()
);
const clearSeasonSchema = z.object({
  season: z.coerce.number().int().min(1).max(99)
});
const resourceLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(500)
});
const readingListRowSchema = z.object({
  season: z.coerce.number().int().min(1).max(99),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  isbn: z.string().regex(/^(?:\d{9}[\dX]|\d{13})$/).optional(),
  month: z.string().trim().min(1).max(30),
  thumbnailUrl: z.string().trim().url().max(500).optional(),
  resources: z.array(resourceLinkSchema).max(12).optional(),
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
    req.userId = Number(payload.sub);
    return next();
  } catch {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Unauthorized" });
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
    role: user.role
  };
}

function syncAdminRoleForConfiguredEmail(user) {
  if (!ADMIN_EMAIL) return user;
  if (!user?.email) return user;
  if (user.email.toLowerCase() !== ADMIN_EMAIL) return user;
  if (user.role === "admin") return user;

  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  return { ...user, role: "admin" };
}

function seasonToLegacyYear(season) {
  return BASE_LEGACY_YEAR + Number(season) - 1;
}

function legacyYearToSeason(year) {
  const season = Number(year) - BASE_LEGACY_YEAR + 1;
  if (!Number.isFinite(season)) return 1;
  return Math.max(1, season);
}

function seedBooksForUser(userId) {
  const bookInsert = db.prepare(`
    INSERT INTO books (id, user_id, year, season, title, author, month, is_featured, created_at)
    VALUES (@id, @user_id, @year, @season, @title, @author, @month, @is_featured, @created_at)
  `);

  const commentInsert = db.prepare(`
    INSERT INTO comments (id, user_id, book_id, text, created_at)
    VALUES (@id, @user_id, @book_id, @text, @created_at)
  `);

  const seeds = {
    [CURRENT_SEASON]: [
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
    [PAST_SEASON]: [
      {
        title: "Station Eleven",
        author: "Emily St. John Mandel",
        month: "January",
        isFeatured: 0,
        comments: ["One of our highest-rated books from last season."]
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
    for (const [season, books] of Object.entries(seeds)) {
      for (const book of books) {
        const bookId = randomUUID();
        const createdAt = new Date().toISOString();
        bookInsert.run({
          id: bookId,
          user_id: userId,
          year: seasonToLegacyYear(Number(season)),
          season: Number(season),
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
        season,
        year,
        title,
        author,
        isbn,
        month,
        thumbnail_url AS thumbnailUrl,
        resources_json AS resourcesJson,
        is_featured AS isFeatured,
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
      ORDER BY season DESC, year DESC, monthOrder DESC, created_at DESC
    `
    )
    .all(userId);

  const comments = db
    .prepare(
      `
      SELECT id, book_id AS bookId, text, created_at AS createdAt
      FROM comments
      WHERE user_id = ?
      ORDER BY created_at DESC
    `
    )
    .all(userId);

  const commentsByBookId = comments.reduce((acc, comment) => {
    if (!acc[comment.bookId]) acc[comment.bookId] = [];
    acc[comment.bookId].push({
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt
    });
    return acc;
  }, {});

  const withComments = books.map((book) => ({
    id: book.id,
    season: book.season,
    year: book.year,
    title: book.title,
    author: book.author,
    isbn: book.isbn || null,
    month: book.month,
    thumbnailUrl: book.thumbnailUrl || null,
    resources: parseResourcesJson(book.resourcesJson),
    isFeatured: Boolean(book.isFeatured),
    comments: commentsByBookId[book.id] || []
  }));
  const stripSeason = ({ season, ...book }) => book;
  const seasonsByNumber = withComments
    .reduce((acc, book) => {
      if (!acc[book.season]) acc[book.season] = [];
      acc[book.season].push(stripSeason(book));
      return acc;
    }, {});
  if (!seasonsByNumber[CURRENT_SEASON]) seasonsByNumber[CURRENT_SEASON] = [];
  if (!seasonsByNumber[PAST_SEASON]) seasonsByNumber[PAST_SEASON] = [];
  const seasons = Object.entries(seasonsByNumber)
    .map(([season, seasonBooks]) => ({
      season: Number(season),
      books: seasonBooks
    }))
    .sort((a, b) => b.season - a.season);
  const pastSeasons = seasons.filter((group) => group.season !== CURRENT_SEASON);

  return {
    currentSeason: CURRENT_SEASON,
    pastSeason: PAST_SEASON,
    seasons,
    currentBooks: withComments
      .filter((book) => book.season === CURRENT_SEASON)
      .map(stripSeason),
    pastBooks: withComments
      .filter((book) => book.season === PAST_SEASON)
      .map(stripSeason),
    pastSeasons,
    otherBooks: withComments
      .filter((book) => book.season !== CURRENT_SEASON && book.season !== PAST_SEASON)
      .map(stripSeason)
  };
}

function ensureColumnExists(tableName, columnName, alterStatement) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    db.exec(alterStatement);
    return true;
  }
  return false;
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

async function enrichRowsWithCovers(rows) {
  if (!COVER_ENRICHMENT_ENABLED) return rows;

  const coverCacheByIsbn = new Map();
  for (const row of rows) {
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
    { label: "IndieBound", aliases: ["indieBoundUrl", "indiebound_url", "indiebound"] }
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

function parseReadingListRows(fileBuffer, fileName, mimeType, defaultSeason) {
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
    const explicitSeason = parseOptionalNumber(getRowField(row, ["season", "Season"]));

    let rawSeason = explicitSeason;
    if (rawSeason === undefined && defaultSeason !== undefined) {
      rawSeason = Number(defaultSeason);
    }
    if (rawSeason === undefined) {
      throw new Error(
        `Invalid row ${index + 1}: season is required (add a season column or choose a season in the Admin form).`
      );
    }

    const normalizedYear =
      rawYear === undefined
        ? rawSeason !== undefined
          ? seasonToLegacyYear(Number(rawSeason))
          : undefined
        : Number(rawYear);
    const candidate = {
      season: rawSeason,
      year: normalizedYear,
      title: getRowField(row, ["title", "Title"]),
      author: getRowField(row, ["author", "Author"]),
      isbn: normalizeIsbn(getRowField(row, ["isbn", "ISBN"])),
      month: getRowField(row, ["month", "Month"]),
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
  const seasons = [...new Set(rows.map((row) => row.season))];

  const deleteSeasonBooks = db.prepare("DELETE FROM books WHERE user_id = ? AND season = ?");
  const clearFeaturedForSeason = db.prepare(
    "UPDATE books SET is_featured = 0 WHERE user_id = ? AND season = ?"
  );
  const findExistingBook = db.prepare(
    `
      SELECT id
      FROM books
      WHERE user_id = ? AND season = ? AND lower(title) = lower(?) AND lower(author) = lower(?)
      LIMIT 1
    `
  );
  const insertBook = db.prepare(
    `
      INSERT INTO books (
        id,
        user_id,
        year,
        season,
        title,
        author,
        isbn,
        month,
        thumbnail_url,
        resources_json,
        is_featured,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const updateBook = db.prepare(
    `
      UPDATE books
      SET
        month = ?,
        thumbnail_url = COALESCE(?, thumbnail_url),
        resources_json = COALESCE(?, resources_json),
        isbn = COALESCE(?, isbn),
        is_featured = ?,
        year = ?,
        season = ?
      WHERE id = ? AND user_id = ?
    `
  );

  const applyTransaction = db.transaction(() => {
    let booksInserted = 0;
    let booksUpdated = 0;

    for (const user of users) {
      if (mode === "replace") {
        for (const season of seasons) {
          deleteSeasonBooks.run(user.id, season);
        }
      }

      for (const row of rows) {
        if (row.isFeatured) {
          clearFeaturedForSeason.run(user.id, row.season);
        }

        const existing = findExistingBook.get(user.id, row.season, row.title, row.author);
        if (existing) {
          updateBook.run(
            row.month,
            row.thumbnailUrl || null,
            row.resources ? JSON.stringify(row.resources) : null,
            row.isbn || null,
            row.isFeatured ? 1 : 0,
            row.year ?? seasonToLegacyYear(row.season),
            row.season,
            existing.id,
            user.id
          );
          booksUpdated += 1;
          continue;
        }

        insertBook.run(
          randomUUID(),
          user.id,
          row.year ?? seasonToLegacyYear(row.season),
          row.season,
          row.title,
          row.author,
          row.isbn || null,
          row.month,
          row.thumbnailUrl || null,
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

function clearSeasonForAllUsers(season) {
  const clearTransaction = db.transaction(() => {
    const usersAffected = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const booksDeleted = db.prepare("SELECT COUNT(*) AS count FROM books WHERE season = ?").get(season).count;
    db.prepare("DELETE FROM books WHERE season = ?").run(season);
    return {
      season,
      usersAffected,
      booksDeleted
    };
  });

  return clearTransaction();
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
    "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
  );

  try {
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const role =
      userCount === 0 || (ADMIN_EMAIL && ADMIN_EMAIL === email) ? "admin" : ALLOWED_ROLES[0];
    const result = insertUser.run(name, email, passwordHash, role, now);
    const userId = Number(result.lastInsertRowid);
    seedBooksForUser(userId);
    const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(userId);
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
    .prepare("SELECT id, name, email, role, password_hash AS passwordHash FROM users WHERE email = ?")
    .get(email);

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const validPassword = await argon2.verify(user.passwordHash, password);
  if (!validPassword) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  user = syncAdminRoleForConfiguredEmail(user);
  const token = createSessionToken(user);
  setSessionCookie(res, token);
  return res.json({ user: formatUser(user) });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  let user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(req.userId);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
  user = syncAdminRoleForConfiguredEmail(user);
  return res.json({ user: formatUser(user) });
});

app.get("/api/books", requireAuth, (req, res) => {
  const payload = getBooksPayload(req.userId);
  res.json(payload);
});

app.post("/api/books/:bookId/comments", requireAuth, (req, res) => {
  const { bookId } = req.params;
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Comment cannot be empty." });
  }

  const exists = db
    .prepare("SELECT id FROM books WHERE id = ? AND user_id = ?")
    .get(bookId, req.userId);

  if (!exists) {
    return res.status(404).json({ error: "Book not found." });
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO comments (id, user_id, book_id, text, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.userId, bookId, parsed.data.text, createdAt);

  return res.status(201).json({
    comment: {
      id,
      text: parsed.data.text,
      createdAt
    }
  });
});

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
    const parsedSeason = uploadSeasonSchema.safeParse(req.body?.season);
    if (!parsedSeason.success) {
      return res.status(400).json({ error: "Season must be between 1 and 99." });
    }

    try {
      const rows = parseReadingListRows(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        parsedSeason.data
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
  "/api/admin/reading-list/clear-season",
  requireAuth,
  requireRole("admin"),
  adminLimiter,
  (req, res) => {
    const parsed = clearSeasonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Season must be between 1 and 99." });
    }

    const summary = clearSeasonForAllUsers(parsed.data.season);
    db.prepare(
      `
      INSERT INTO reading_list_uploads (id, admin_user_id, filename, mode, rows_imported, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      randomUUID(),
      req.userId,
      `clear-season-${parsed.data.season}`,
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

app.use((error, _req, res, _next) => {
  if (String(error.message).includes("CORS")) {
    return res.status(403).json({ error: "CORS blocked for this origin." });
  }
  return res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
