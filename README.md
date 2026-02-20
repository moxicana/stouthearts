# StoutHearts Book Club

Vue + Tailwind app with an Express API for secure authentication and per-user book data.

## What is included

- Tailwind CSS setup (`tailwind.config.js` + `postcss.config.js`)
- Secure auth flow:
  - password hashing with `argon2id`
  - HTTP-only cookie sessions (JWT)
  - `helmet` headers and auth rate limiting
  - input validation via `zod`
- SQLite persistence for users, books, and comments
- Seeded example books for current volume and past volume per new account
- Role-based access:
  - `admin` can upload reading lists
  - `member` can view books and add comments

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment config:

```bash
cp .env.example .env
```

3. Set a strong `JWT_SECRET` in `.env`.
4. Optionally set `ADMIN_EMAIL` in `.env` to auto-grant admin role to that email at registration.

The first registered account is also promoted to `admin` automatically.

## Run (web + API)

```bash
npm run dev
```

- Web app: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3000`
- If `5173` is already in use, stop the other process first (this project uses a fixed dev port).

## Build web app

```bash
npm run build
```

## Deployment

See `/Users/zackkamp/Desktop/stouthearts/DEPLOYMENT.md` for:

- Cloudflare Pages frontend deployment
- Render API deployment with persistent disk
- GitHub Actions CI + main-branch auto-deploy workflow

## Admin reading list uploads

Admins can open the `Admin` page in the app and upload `.csv` or `.json` reading list files.

- Clear volume:
  - `Clear Volume` in the Admin page deletes all books (and related comments) for the selected volume across all users.
  - Use this before a new import when you want a clean reset for that volume.
- Backfill covers:
  - `Backfill Covers` in the Admin page fills missing `thumbnailUrl` values for existing books that have an `isbn`.
  - Uses Open Library covers first, then Google Books as fallback.

- Upload mode:
  - `append`: insert/update matching books for all users
  - `replace`: replace touched volumes for all users before import
- Supported columns/fields:
  - `volume` (number)
  - `year` or `Year` (number, optional; used for chronological ordering only)
  - `title` (string)
  - `author` (string)
  - `isbn` or `ISBN` (optional, recommended for auto-cover lookup)
  - `month` (string)
  - `thumbnailUrl` / `thumbnail_url` (optional URL to the book cover)
  - `amazonUrl`, `bookshopUrl`, `barnesAndNobleUrl`, `indieBoundUrl` (optional resource links)
  - `resource1Label` + `resource1Url` (optional custom link; supports `resource2*` and `resource3*`)
  - `resources` (optional JSON array of `{ "label": "...", "url": "..." }`)
  - `isFeatured` (optional boolean-like: `true/false`, `1/0`, `yes/no`)
- Header names are case-insensitive (for example: `Volume`, `Year`, `Title`, `Author`, `Month`).
- `volume` is required for each row, either from the CSV/JSON `volume` column or from the selected volume in the Admin page form.
- Book lists are shown in chronological order (`year` asc, then `month` asc).
- To import multiple past volumes in one upload, include a `volume` column in the file and choose `Use volume column from CSV` in the Admin page.
- In the app, book cards are clickable and open a details page at `/books/:bookId` with cover image, comments, and resources links.
- If `thumbnailUrl` is missing but `isbn` is present, import will auto-populate cover images using Open Library Covers API with Google Books fallback.

CSV example:

```csv
volume,year,title,author,isbn,month,isFeatured,thumbnailUrl,amazonUrl,bookshopUrl
2,2026,The Fifth Season,N. K. Jemisin,9780316229296,August,true,https://example.com/fifth-season.jpg,https://www.amazon.com/dp/0316229296,https://bookshop.org/p/books/the-fifth-season/123
2,2026,The City We Became,N. K. Jemisin,9780316494199,September,false,,https://www.amazon.com/dp/0316494194,
1,2025,Anxious People,Fredrik Backman,9781501160833,October,false,,https://www.amazon.com/dp/1501160834,https://bookshop.org/p/books/anxious-people/123
```

JSON example:

```json
[
  {
    "volume": 2,
    "year": 2026,
    "title": "The Fifth Season",
    "author": "N. K. Jemisin",
    "isbn": "9780316229296",
    "month": "August",
    "thumbnailUrl": "https://example.com/fifth-season.jpg",
    "resources": [
      { "label": "Amazon", "url": "https://www.amazon.com/dp/0316229296" },
      { "label": "Bookshop", "url": "https://bookshop.org/p/books/the-fifth-season/123" }
    ],
    "isFeatured": true
  }
]
```

Cover enrichment settings (`.env`):

- `COVER_ENRICHMENT_ENABLED=true`
- `COVER_LOOKUP_TIMEOUT_MS=3000`

Admin rate-limit settings (`.env`):

- `ADMIN_RATE_LIMIT_WINDOW_MS=900000` (15 minutes)
- `ADMIN_RATE_LIMIT_MAX=200`

## Security notes

- For production, run behind HTTPS and keep `NODE_ENV=production`.
- Use a long random `JWT_SECRET` and rotate it as part of key management.
- Restrict `CLIENT_ORIGIN` to trusted frontend domains only.
- Registration requires passwords with at least 8 characters, with letters and numbers.
- Uploaded files are size-limited to 1MB and parsed/validated server-side.
