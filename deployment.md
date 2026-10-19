# Deployment

This project is prepared for a Cloudflare Wrangler deployment using a Cloudflare D1 SQLite database.

## Required setup

1. Install dependencies:
   - `npm install`
2. Create the D1 database (already done for this project):
   - `npx wrangler d1 create student-academic-reporting-db`
3. Verify the `database_id` in `wrangler.jsonc` matches that database — it is already set to `2d13a1a3-29ae-48c7-b461-4bc2ce5f94a2` (`student-academic-reporting-db`). Confirm with `npx wrangler d1 list`.
4. Apply the schema to the D1 instance:
   - `npx wrangler d1 migrations apply student-academic-reporting-db --local` (needed for `npm run wrangler:dev`)
   - `npx wrangler d1 migrations apply student-academic-reporting-db --remote`
   - Status check: `npx wrangler d1 migrations list student-academic-reporting-db --remote` must report **No migrations to apply**. Migrations `0000`–`0007` are currently applied both locally and remotely.
5. Set the app runtime secret:
   - `npx wrangler secret put SETUP_TOKEN` — the only runtime secret; `SETUP_TOKEN` is already set on the `student` worker. There is no session secret to configure (sessions are random server-stored tokens).
   - `npx wrangler secret list` to confirm. Do **not** set `TEACHER_INITIAL_PASSWORD` unless you want a different shared starting password (see below).
6. Run the app locally with Wrangler when needed:
   - `npm run wrangler:dev`

## Verify before deploying

Run these in order; each must pass before `npm run wrangler:deploy`:

1. `npx drizzle-kit generate` — must report **No schema changes, nothing to migrate** (schema and `d1/migrations/` are in sync).
2. `npx wrangler d1 migrations list student-academic-reporting-db --remote` — **No migrations to apply**.
3. `npx wrangler secret list` — `SETUP_TOKEN` present.
4. `npm run typecheck && npm run lint && npm test` — all green; with `npm run dev` running, the four smoke suites in the README must pass too.
5. `npm run build` — must produce `.open-next/worker.js` and `.open-next/assets`.
6. `npx wrangler deploy --dry-run --outdir <temp-dir>` — validates the bundle and `wrangler.jsonc` without publishing.

## Environment variables

Use these values for your deployment environment:

- `SETUP_TOKEN` — one-time bootstrap token for the first admin setup; set with `npx wrangler secret put SETUP_TOKEN`
- `TEACHER_INITIAL_PASSWORD` — optional shared starting password for newly imported teachers; **intentionally left unset**, so imported teachers use the built-in `school123` and replace it themselves from Change Password. Only set it (`npx wrangler secret put TEACHER_INITIAL_PASSWORD`) if you want a different shared starting password.
- `NODE_ENV=production` — required for the session cookie's `Secure` flag; the OpenNext bundler statically replaces `process.env.NODE_ENV` with `"production"` in the worker, so no `vars` entry is needed.
- `NEXT_TELEMETRY_DISABLED=1` — build-time only, keeps telemetry off.

`AUTH_SECRET` in `.env.example` is not read by the application and can be ignored or removed. For local development, `DATABASE_URL` can point to a SQLite file such as `./.data/local.db`.

## Wrangler configuration

The project includes a D1 binding in `wrangler.jsonc`:

- binding: `DB`
- database_name: `student-academic-reporting-db`

This matches the code in `src/db/index.ts`, which prefers the Wrangler D1 binding and falls back to a local SQLite file when not running in Cloudflare.

## Deployment flow

1. Verify the D1 database ID in `wrangler.jsonc` (see *Required setup*).
2. Run `npm install`.
3. Work through **Verify before deploying** above.
4. Run `npm run wrangler:deploy` — this runs `npm run build` (`next build` + `npx @opennextjs/cloudflare build`) and then `wrangler deploy`, so the bundle is always fresh.
5. Confirm the new version with `npx wrangler deployments list --name student`, then open the app.

If a deploy is bad, roll back with `npx wrangler rollback --name student`. A deploy is code-only: the remote schema is applied separately with `wrangler d1 migrations apply --remote`, so code and schema must be moved together (see the checklist).

## Notes

- This project uses SQLite/D1, not PostgreSQL.
- Keep all secrets out of version control.
- The app is compatible with Wrangler D1 and local SQLite development.
- Migrations `0000`–`0007` live in `d1/migrations/` and are **already applied to the remote D1 database** (verified with `npx wrangler d1 migrations list student-academic-reporting-db --remote`), as well as to the local wrangler D1 and the local SQLite file.
- When you add a migration, apply it to remote **before** deploying the build that expects it — a deploy is code-only, so code and schema move together:
  - `0003` club tables (`clubs`/`club_teachers`/`club_members`/`club_activities`) + drops `teachers.department`
  - `0004` monthly record entry (§193): `monthly_entries`, `monthly_student_entries`
  - `0005` `club_activity_records` (per-student club activity rows)
  - `0006` daily→monthly merge: renames `daily_lessons`→`monthly_lessons`, `daily_student_records`→`monthly_student_records`, column `daily_lesson_id`→`monthly_lesson_id`, backfills `audit_logs.entity_type` `'daily_lesson'`→`'monthly_lesson'`, drops `settings.reportingCadence` (data preserved by the rename)
  - `0007` `subject_students` (teacher-managed subject rosters behind **Manage students** on the monthly form)
- `.open-next/` is generated by `npm run build` and ignored by Git — `npm run wrangler:deploy` rebuilds immediately before deploying, and `.open-next/` must never be committed.
- All password entry points share one rule: at least 6 characters with an uppercase letter, a lowercase letter, a number and a symbol (setup, password change, admin/teacher create and reset, and generated passwords).