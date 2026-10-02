# Wellspring — school daily reporting

A multi-organization daily academic and behavioural reporting application. Next.js App Router, TypeScript, Drizzle ORM, SQLite/D1, bcryptjs, server-side sessions and Zod. Daily records produce deterministic monthly summaries. No timetable, evidence uploads, or external AI dependency.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a local SQLite file such as `./.data/local.db`, plus a long random `SETUP_TOKEN`.
3. For local SQLite development, initialize a local file-based database and run `npx drizzle-kit migrate` to apply the schema. For Cloudflare deployment, use Wrangler D1 and `wrangler d1 migrations apply` instead of a PostgreSQL server.
4. `npm run dev` and open `/`. Choose **First-time setup** and enter the environment setup token to create the first super administrator. Setup is rejected once any user exists. Do not publish the setup token.
5. Super admin creates an organization and its primary admin. Admin creates academic years, terms, classes, subjects, teachers, students, and assignments in that order.

For local-only sample data, the demo seed remains available, but it should be treated as disposable and not as the default application login. Use the setup flow to create your own administrator and keep the real credentials in a local file such as `logins.text`, which is ignored by Git.

Run the tests with `npm test` (business rules `scripts/rules.test.ts` plus `scripts/pdf.test.ts`), or a single file with `npx tsx --test scripts/rules.test.ts`.

## Excel / CSV import format

The app supports bulk import for students and teachers (together with their teaching assignments) from Excel `.xlsx` or CSV files — no separate assignment file is needed. Files are limited to 10 MB and 1000 data rows per upload.

Upload order matters: **students first, then teachers.** The students file defines the academic year (from its file name), and the teachers file then attaches its assignments to that year.

Upload the generated `students-import-2026-2027.xlsx` and `teachers-import-2026-2027.xlsx` (see below) rather than the raw school lists: the raw students workbook still contains the MP sheets, which would create MP grades and classes.

### Students workbook

Every worksheet that carries a `No | Name | Surname | Year` header row is read, including sheets that hold two class tables side by side (for example `Y7` with `7A` and `7B`).

| No | Name | Surname | Year |
| --- | --- | --- | --- |
| 1 | Mayanja | Promise Kirster | MP1 |

How it works:
- Title rows above the header are skipped and all sheets in the workbook are scanned.
- `Year` holds the class (`MP1`, `7A`, `10`); the grade is derived from it (`7A` → `Grade 7`, `MP1` → `MP`).
- `Student ID` is generated as `<Year>-<Class>-<No>` so a later year's file never overwrites another child's record.
- The academic year comes from the file name (`List of students 2026-2027.xlsx` → `2026-2027`).
- Missing grades, classes and academic years are created during the import. `Status` is optional: when the file has no `Status` column the row keeps its current status (a new student is `ACTIVE`); when it does, only `ACTIVE` and `INACTIVE` are accepted.

The workbook must use this `No | Name | Surname | Year` layout — the grade, class, academic year and student ID are all derived from it, and sheets without that header row are ignored (which is how instruction sheets are skipped).

`npx tsx scripts/build-import-files.ts` rebuilds two ready-to-upload workbooks from your own lists: `students-import-2026-2027.xlsx` (one sheet per class, MP sheets removed) and `teachers-import-2026-2027.xlsx` (one row per teacher, subject codes expanded to full names). Both carry a READ ME sheet.

### Teachers workbook

| NO | NAME | SURNAME | CONTACT DETAIL | NATIONALITY | EMAIL | SUBJECTS | CLASSES |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | John | Mugabo | +250788123456 | Burundian | john@school.com | Mathematics, ICT | 7A, 8A |

How it works:
- Title rows above the header are skipped, hyperlink and rich-text email cells are read, and a teacher listed on several rows is merged into one record with the combined subjects and classes.
- Each value in `SUBJECTS` and `CLASSES` is a separate assignment. Common codes map onto the matching subject (`MATHS` → Mathematics, `GC` → Global Citizenship, `EASL` → English); unknown subjects and missing classes are created. A bare class code such as `7` is assigned to every section that exists (`7A`, `7B`).
- Teachers without an email receive a pending address (`pending-…@placeholder.invalid`) and sign in with the generated username until the organization supplies a real one. They are named in the import results so the admin can update them later from the teachers list.
- Every new teacher account gets a generated password, and `teacher-passwords-<date>.csv` downloads automatically when the import finishes. It lists teacher ID, name, email, username, password and whether the email was provided or pending. Distribute it securely and delete it afterwards — passwords are stored only as bcrypt hashes.

### Import flow

The detected columns are matched to the import format automatically and shown for review (they cannot be mapped by hand), then an explicit confirmation. The server validates each row, creates the missing school records and reports row-level errors, which can be downloaded as an error CSV. Re-running the same file updates the existing records instead of duplicating them, and never revives a student you deactivated.

## Daily workflow

The teacher selects an assigned class and subject, a lesson date within the previous 14 calendar days in the organization's timezone, and a topic. The server checks the year, term, assignment and active class roster. **Set all normal** fills present/good/active/completed/good. Absent students have null academic fields. Submission requires the full roster and comments for improvement observations. A single server operation commits the lesson and observations. Drafts and returned reports can be revised; approved reports are read-only for teachers. The admin reviews, approves or returns reports with a reason, can make reason-required date corrections, and can close/reopen months. Teachers may delete only their own drafts. Admins can activate/deactivate teachers (revoking their sessions), inspect student timelines, and review optional significant observations; super admins can reset primary-admin access (revoking sessions).

Monthly reports derive from submitted, under-review and approved observations by `lessonDate`. Student and lesson names are captured on new records so later renames do not relabel those historical reports. Closing a month freezes its calculation thresholds; reopening does not erase that snapshot. Reports show source counts and reject oversized unfiltered datasets instead of silently truncating. They show observation counts, topics, attendance, punctuality, significant comments and calculation-rule version. CSV and real XLSX workbook downloads and browser Print / Save as PDF are available. Student and teacher CSV/XLSX imports use preview, automatic column matching, explicit confirmation, server validation and an error CSV.

## Security notes

Sessions are random server-stored tokens, hashed at rest, HttpOnly, SameSite=Lax and Secure in production. Passwords use bcrypt. Auth and data requests are server-authorized; teacher permissions use active assignments and tenant IDs taken from the authenticated session, never the payload. Failed-login throttling and origin checks are enabled. Audit entries record material changes. Keep `DATABASE_URL`, `SETUP_TOKEN`, passwords and all generated credentials out of version control. Distribute initial teacher passwords securely and require users to change them. CSV exports guard against formula injection.

## Database

The data layer is chosen at runtime by `src/db/index.ts`:

| Environment | Database | Configuration |
| --- | --- | --- |
| Local development (`npm run dev`) | SQLite file | `DATABASE_URL=file:./.data/local.db` in `.env`; the `.data/` folder is created automatically |
| Cloudflare deployment | D1 | the `DB` binding from `wrangler.jsonc` (`database_name: student-academic-reporting-db`); `DATABASE_URL` is ignored when the binding exists |

There is no PostgreSQL/MySQL dependency. Schema lives in `src/db/schema.ts`, generated SQL in `d1/migrations/`.

- Apply migrations locally: `npm run db:migrate` (drizzle-kit → `DATABASE_URL`).
- Apply migrations to D1: `npx wrangler d1 migrations apply student-academic-reporting-db --remote`.
- Optional demo data (local only): `npm run db:seed`.
- Back up a local database by copying `.data/local.db`; it is ignored by Git.

## Deployment

The app builds for Cloudflare Workers with OpenNext + Wrangler (`wrangler.jsonc`, main `.open-next/worker.js`, assets in `.open-next/assets`).

1. `npm install`
2. `npm run build` — runs `next build` and then `npx @opennextjs/cloudflare build`.
3. `npx wrangler login` (first time).
4. `npm run db:migrate`, then `npx wrangler d1 migrations apply student-academic-reporting-db --remote` (first deploy and after every migration).
5. `npm run wrangler:deploy` — pushes the worker and assets to Cloudflare.
6. Local rehearsal of the production bundle: `npm run wrangler:dev`.

After deployment open `/` and complete **First-time setup** with `SETUP_TOKEN` to create the first super administrator. In production set a strong `SETUP_TOKEN` and `DATABASE_URL` only for local use; the D1 binding supplies the database.

Deployment notes:
- `.open-next/` and `.wrangler/` are build output — do not edit them by hand. Parts of `.open-next/` are tracked by Git, so always run `npm run build` immediately before `wrangler deploy` (a `git checkout -- .open-next` between build and deploy would ship stale output).
- Set secrets per environment with `npx wrangler secret put SETUP_TOKEN` (the worker has no `SETUP_TOKEN` until this is done, and first-time setup stays disabled).
- The app reads the D1 binding from the Cloudflare request context at runtime; without it (for example in a plain Node server) it falls back to `DATABASE_URL`.


## Organization logo

Logos are per organization — several organizations can share one deployment and each keeps its own image.

1. **Settings → Organization → Logo URL (admin)**, or the super-admin organization form, has an **Upload logo file** picker: PNG, JPG, WebP or SVG up to 200 KB. The file is stored with that organization only (as a data URI in `organizations.logo_url`), then **Save** applies it. The preview and **Remove logo** button sit under the picker.
2. Alternatively paste a full `https://…` image URL, or the site path of a file in `public/`. The default for new organizations is `/icons/school_logo.png` (`public/icons/school_logo.png`).
3. Where it appears: the sidebar (signed in, the current organization's logo), and the sign-in screen. The sign-in screen resolves the logo while you type: an email address matches the organization of accounts using that domain (or `organizations.domain`), and single-organization deployments show their logo for any identifier. With no match it falls back to `/icons/school_logo.png`, then to the default icon.


# academic_progress_tracker
