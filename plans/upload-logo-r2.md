# Plan: Store organization logos as files on Cloudflare R2

## Current behaviour

- `LogoField` (`src/app/page.tsx:113`) reads the chosen file with `readImageFile`
  (`src/lib/logo.ts:18`) into a base64 **data URI** held in React state.
- On **Save** the data URI is posted to `POST /api/app` and written to
  `organizations.logo_url` (settings: `src/app/api/app/route.ts:918`,
  super-admin organization form: `src/app/api/app/route.ts:626`).
- No file ever leaves the browser; the DB row carries the whole image
  (`LOGO_MAX_CHARS = 400000`).

## Target design

**Decision 1 — dedicated upload endpoint, upload happens on file select (not at save).**
`POST /api/logo` stores the image immediately and returns a site path
(`/api/logo/<key>`); `LogoField` puts *that path* into the form value. What you
see in the preview is exactly what Save persists — no surprise conversion at
save time, and the save payload shrinks from ~270 KB to ~80 chars.

**Decision 2 — private R2 bucket, served same-origin through an app route.**
A public R2 URL would break the app: the PDF exporter fetches the logo with
`fetch()` under `connect-src 'self'` (`next.config.ts:19`) and draws it to
canvas (cross-origin draw taints the canvas → `toDataURL` throws → PDF falls
back to the bundled logo). Serving `/api/logo/<key>` from the worker keeps
`img-src 'self'`, `connect-src 'self'` and canvas cleanliness intact, needs no
CORS/public-bucket config, and the bucket stays private.

**Decision 3 — content-addressed keys: `logos/<sha256>.<ext>`.**
No org id in the key, so the super-admin *create organization* form can upload
before the org row exists; identical files dedupe; keys are immutable, so
`Cache-Control: public, max-age=31536000, immutable` is safe. Cross-org
overwrite is impossible. "Each organization keeps its own logo" stays true
because the isolation lives in `organizations.logo_url`, not the key.

**Decision 4 — local disk fallback when no R2 binding**, mirroring the existing
`src/db/index.ts` pattern (no D1 binding → `file:./.data/local.db`). Plain
`next dev` has no Cloudflare context, so uploads land in `.data/uploads/`
(already gitignored via `.data/`) and are served by the same route from disk.

**No D1 migration is needed** — `logo_url` is already `text`, and
`logoUrlSchema` already accepts paths starting with `/`.

## File-by-file changes

### 1. `wrangler.jsonc` — add the binding

```jsonc
"r2_buckets": [
  { "binding": "LOGOS", "bucket_name": "student-logos" }
]
```

Bucket creation (`npx wrangler r2 bucket create student-logos`) is a documented
deployment step — **run later, not part of this change**.

### 2. New `src/lib/logoStore.ts` — storage access

- `getLogoBucket()` — same candidate scan as `getD1Binding()`
  (`src/db/index.ts:8`): `globalThis.LOGOS`, `context.env.LOGOS` from
  `Symbol.for('__cloudflare-context__')`, `process.env.LOGOS`; must expose
  `.put`/`.get` to count as a binding. Return `null` when absent.
- Minimal structural typing (same style as the `any` + method-shape check in
  `src/db/index.ts`) — no `workers-types` tsconfig churn.
- `putLogo(bytes, contentType): Promise<string>`
  - ext from sniffed type (`png|jpg|webp|svg`), `sha256(bytes)` →
    `logos/<hash>.<ext>`, return `/api/logo/<hash>.<ext>`
  - R2: `bucket.put(key, bytes, { httpMetadata: { contentType } })`
  - fallback: `fs.writeFile('.data/uploads/<key>', bytes)` (mkdir -p)
- `getLogo(key): Promise<{ bytes, contentType } | null>` — R2 `get` or disk read.
- `isStoredLogoPath(value)` — `value.startsWith('/api/logo/')`.

### 3. New `src/lib/logoSniff.ts` (or extend `src/lib/logo.ts`) — server-side type checks

Client MIME is not trusted. Magic-byte sniffing:

- PNG `\x89PNG\r\n\x1a\n`, JPEG `\xFF\xD8\xFF`, WebP `RIFF`+`WEBP`,
  SVG: text beginning (after BOM/whitespace/`<?xml…?>`) with `<svg`.
- `svgIsSafe(text)` rejects `<script`, `javascript:`, `on…=` handlers,
  `<foreignObject`, external `href`/`xlink:href` — SVG is the only format that
  can carry active content.
- Reject anything else with a 400 (`AppError`), plus the existing
  `LOGO_MAX_BYTES` size check.

### 4. New `src/app/api/logo/route.ts` — `POST` upload

- `checkOrigin(req)` + `requireUser(['ADMIN','SUPER_ADMIN'])`
  (`src/lib/security.ts:28,50`) — teachers must not rebrand the school.
- Body: `{ data: "data:image/…" }`, validated with
  `z.string().max(LOGO_MAX_CHARS)`; decode base64 → bytes.
- Size ≤ 200 KB, sniff, SVG safety, then `putLogo(...)`.
- Respond `{ url: "/api/logo/logos/<hash>.<ext>" }`.
- `export const dynamic = 'force-dynamic'`.

### 5. New `src/app/api/logo/[key]/route.ts` — `GET` serve (public, no auth)

The sign-in screen and PDF export both need it unauthenticated (branding is
public by design; `src/app/api/auth/route.ts:38` already serves `logoUrl`
before login).

- Validate key strictly: `/^[a-f0-9]{64}\.(png|jpg|webp|svg)$/` → else 404
  (no path traversal; single segment, no `/`).
- `getLogo(key)` → 404 when missing.
- Headers: sniffed/`httpMetadata` `Content-Type`,
  `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<hash>"` +
  `304` on `if-none-match`.
- SVG extra hardening: `Content-Security-Policy: default-src 'none';
  style-src 'unsafe-inline'; sandbox` so a directly-opened SVG cannot run
  script same-origin (`X-Content-Type-Options: nosniff` is already global).

### 6. `src/app/page.tsx` — `LogoField` upload flow

In the file input handler (`src/app/page.tsx:147`):

1. Keep `readImageFile(file)` for instant client-side validation + preview.
2. `POST /api/logo` with `{ data }` (reuse the existing JSON `fetch` style of
   `post()` at `src/app/page.tsx:280`, but as a direct call — new action-less
   endpoint).
3. On success: `onChange(url)`, notice
   `Logo "x.png" uploaded — save to apply it to this organization.`
4. On failure: `onError(message)` and leave the previous value untouched.

Also update the "uploaded" detection (`src/app/page.tsx:124`) to
`value.startsWith('data:') || isStoredLogoPath(value)` so the placeholder/hint
treats `/api/logo/…` as a stored upload (and the input keeps showing the
readable path). Hint copy at `src/app/page.tsx:161` stays accurate; optionally
add "stored securely in cloud object storage" — keep the 200 KB / per-org
wording.

Both call sites (`src/app/page.tsx:2702` super-admin org form,
`src/app/page.tsx:2861` settings) need no changes — they just pass the value
through.

### 7. `src/app/api/app/route.ts` — nothing required for saving

`logoUrlSchema` already accepts `/api/logo/…`. **No change** to the
settings/organization handlers beyond what the migration needs (below).

### 8. Migration: `migrateLogos` action + driver script

**Server action** in `src/app/api/app/route.ts` (SUPER_ADMIN only, near the
other super-admin actions at `src/app/api/app/route.ts:624`):

- `action: 'migrateLogos'` → select orgs where
  `logoUrl LIKE 'data:image/%'`, and for each: decode base64 → sniff →
  `putLogo` → `UPDATE organizations SET logo_url = <path>`.
- Idempotent (skips non-`data:` rows), per-row try/catch: a bad row is reported
  and left untouched, never dropped.
- Returns `{ scanned, migrated, skipped, failures: [{ orgId, reason }] }`.
- Runs inside the worker, so it has **both** the D1 and R2 bindings — no S3
  credentials or Cloudflare API tokens needed. (A `tsx` script has no bindings;
  driving the running app is the only path that works for local *and* remote.)

**Driver** `scripts/migrate-logos.ts` (pattern: `scripts/local-app-test.ts:29`):

- env/args: `APP_URL`, super-admin identity + password.
- login → `POST /api/app {action:'migrateLogos'}` → print the report, exit
  non-zero if `failures.length > 0`.
- Usage (documented, run later against the target environment):
  `APP_URL=… SUPER_IDENTITY=… SUPER_PASSWORD=… npx tsx scripts/migrate-logos.ts`

### 9. Tests — `scripts/logo.test.ts` + wiring

Unit tests (node:test pattern, `scripts/password.test.ts`):

- sniffing: each real magic byte → correct ext; random bytes → rejected.
- `svgIsSafe`: rejects `<script>`/`onload=`/`javascript:`; accepts a plain
  `<svg viewBox=…>` stub.
- `putLogo`/`getLogo` round-trip on the **disk fallback** (temp dir), incl.
  immutability of the derived key.
- `logoUrlSchema` accepts `/api/logo/<64hex>.png`; still accepts legacy
  `data:image/…` (migration may not have run yet).

Add to the `test` script chain in `package.json:10`.

**Integration** (`scripts/local-app-test.ts`, optional but cheap): after the
existing settings round-trip, log in as admin, `POST /api/logo` with a tiny PNG
data URI, assert the returned path round-trips through `GET /api/logo/…` with
`content-type: image/png`, then restore the original `logoUrl`.

### 10. Docs

- `README.md` §"Organization logo" (line 134): file upload now stores the image
  in Cloudflare R2 (or `.data/uploads/` locally) and the DB keeps only
  `/api/logo/<key>`; add the migration command.
- `deployment.md`: new "R2 bucket" section —
  `npx wrangler r2 bucket create student-logos`, the `LOGOS` binding in
  `wrangler.jsonc`, that no public access/CORS is required, and the migration
  step (`npx tsx scripts/migrate-logos.ts` against the deployed URL) to run
  once after deploy.

## Explicitly unchanged

- `logoUrlSchema`, `organizations.logo_url` column, all existing D1 migrations.
- CSP in `next.config.ts` (`img-src … 'self'`, `connect-src 'self'` already
  cover `/api/logo/…`).
- `loadLogoDataUrl` (`src/lib/reportPdf.ts:439`) — a same-origin path fetches
  cleanly and is not canvas-tainting.
- Sign-in logo lookup (`src/app/api/auth/route.ts:13`), sidebar, reports.
- Default `/icons/school_logo.png` and the data-URI fallback logo
  (`src/lib/defaultLogo.ts`).

## Verification

1. `npm run lint` && `npm run typecheck`
2. `npm test` (includes the new `scripts/logo.test.ts`)
3. Manual, plain `next dev` (disk fallback):
   - Settings → upload a PNG ≤ 200 KB → confirm a file appears under
     `.data/uploads/logos/`, preview shows, **Save** → `logo_url` is
     `/api/logo/<hash>.png`.
   - Sidebar + sign-in screen render it; a class/student PDF embeds it
     (proves same-origin fetch + untainted canvas).
   - Rejection paths: >200 KB file, non-image file, SVG containing `<script>`.
4. `npm run wrangler:dev` (local Miniflare R2): repeat the upload once to
   confirm the binding path, `bucket.get` returns the object.
5. Migration: seed/keep one org with a data-URI logo →
   `npx tsx scripts/migrate-logos.ts` → row rewritten, image identical;
   re-run → `migrated: 0` (idempotent).

## Not run now (deployment steps, documented only)

- `npx wrangler r2 bucket create student-logos`
- `npm run wrangler:deploy` (user said: do not deploy)
- One-time migration against the deployed environment
