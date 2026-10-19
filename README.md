# Wellspring — school reporting

A multi-organization academic and behavioural reporting application. Next.js App Router, TypeScript, Drizzle ORM, SQLite/D1, bcryptjs, server-side sessions and Zod. Reports are filed as one monthly record per class, subject and month (§193) and roll up into deterministic monthly summaries. Legacy dated lesson reports remain readable and reviewable but are no longer created by the UI. No timetable, evidence uploads, or external AI dependency.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a local SQLite file such as `./.data/local.db`, plus a long random `SETUP_TOKEN`.
3. For local SQLite development, initialize a local file-based database and run `npx drizzle-kit migrate` to apply the schema. For Cloudflare deployment, use Wrangler D1 and `wrangler d1 migrations apply` instead of a PostgreSQL server.
4. `npm run dev` and open `/`. Choose **First-time setup** and enter the environment setup token to create the first super administrator. Setup is rejected once any user exists. Do not publish the setup token.
5. Super admin creates an organization and its primary admin. Admin creates academic years, terms, classes, subjects, teachers, students, and assignments in that order. The super admin can later edit that admin's name, username and email (**Edit Admin** in the Schools table) or reset their password (**Reset Admin**), both audited.

For local-only sample data, the demo seed remains available, but it should be treated as disposable and not as the default application login. Use the setup flow to create your own administrator and keep the real credentials in a local file such as `logins.text`, which is ignored by Git.

Run the tests with `npm test` (business rules `scripts/rules.test.ts`, the password rule `scripts/password.test.ts`, PDF output `scripts/pdf.test.ts` and the monthly record helpers `scripts/monthly.test.ts`), or a single file with `npx tsx --test scripts/rules.test.ts`. With `npm run dev` running, four smoke suites replay the full app against the local server: `npx tsx scripts/local-app-test.ts` (the whole application, 135 checks — auth, roles, reports, review, entities, imports, subject rosters, club members, account changes), `npx tsx scripts/local-import-test.ts` (imports and role logins), `npx tsx scripts/local-clubs-test.ts` (the club workflow with review) and `npx tsx scripts/local-monthly-test.ts` (the monthly record workflow end to end).

## Excel / CSV import format

The app supports bulk import for students and teachers (together with their teaching assignments) from Excel `.xlsx` or CSV files — no separate assignment file is needed. Files are limited to 10 MB and 1000 data rows per upload.

Upload order matters: **students first, then teachers.** The students file defines the academic year (from its file name), and the teachers file then attaches its assignments to that year.

Upload the generated `students-import-2026-2027.xlsx` and `teachers-import-2026-2027.xlsx` (see below) rather than the raw school lists: the raw students workbook still contains the MP sheets, which would create MP year levels and classes.

### Students workbook

Every worksheet that carries a `No | Name | Surname | Year` header row is read, including sheets that hold two class tables side by side (for example `Y7` with `7A` and `7B`).

| No | Name | Surname | Year |
| --- | --- | --- | --- |
| 1 | Mayanja | Promise Kirster | MP1 |

How it works:
- Title rows above the header are skipped and all sheets in the workbook are scanned.
- `Year` holds the class (`MP1`, `7A`, `10`); the year level is derived from it (`7A` → `Year 7`, `MP1` → `MP`).
- `Student ID` is generated as `<Year>-<Class>-<No>` so a later year's file never overwrites another child's record.
- The academic year comes from the file name (`List of students 2026-2027.xlsx` → `2026-2027`).
- Missing years, classes and academic years are created during the import. `Status` is optional: when the file has no `Status` column the row keeps its current status (a new student is `ACTIVE`); when it does, only `ACTIVE` and `INACTIVE` are accepted.

The workbook must use this `No | Name | Surname | Year` layout — the year, class, academic year and student ID are all derived from it, and sheets without that header row are ignored (which is how instruction sheets are skipped).

`npx tsx scripts/build-import-files.ts` rebuilds two ready-to-upload workbooks from your own lists: `students-import-2026-2027.xlsx` (one sheet per class, MP sheets removed) and `teachers-import-2026-2027.xlsx` (one row per teacher, subject codes expanded to full names). Both carry a READ ME sheet.

### Teachers workbook

| NO | NAME | SURNAME | CONTACT DETAIL | NATIONALITY | EMAIL | SUBJECTS | CLASSES |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | John | Mugabo | +250788123456 | Burundian | john@school.com | Mathematics, ICT | 7A, 8A |

How it works:
- Title rows above the header are skipped, hyperlink and rich-text email cells are read, and a teacher listed on several rows is merged into one record with the combined subjects and classes.
- Each value in `SUBJECTS` and `CLASSES` is a separate assignment. Common codes map onto the matching subject (`MATHS` → Mathematics, `GC` → Global Citizenship, `EASL` → English); unknown subjects and missing classes are created. A bare class code such as `7` is assigned to every section that exists (`7A`, `7B`).
- Teachers without an email receive a pending address (`pending-…@placeholder.invalid`) and sign in with the generated username until the organization supplies a real one. They are named in the import results so the admin can update them later from the teachers list.
- There is no `Department` column — the `teachers.department` field was removed from the schema, UI and API, so a `Department` column in a source file is simply ignored.
- Every new teacher account gets a generated password, and `teacher-passwords-<date>.csv` downloads automatically when the import finishes. It lists teacher ID, name, email, username, password and whether the email was provided or pending. Distribute it securely and delete it afterwards — passwords are stored only as bcrypt hashes.

### Import flow

The detected columns are matched to the import format automatically and shown for review (they cannot be mapped by hand), then an explicit confirmation. The server validates each row, creates the missing school records and reports row-level errors, which can be downloaded as an error CSV. Re-running the same file updates the existing records instead of duplicating them, and never revives a student you deactivated.

## Student management

The **Students** page provides rosters, enrollment status and longitudinal profiles. Students themselves are created either one at a time (**Management → Students**) or in bulk (**Import**).

- **Create a single student** — on **Management → Students**, fill in *Student ID*, *First name*, *Last name*, *Year*, *Class* and *Academic year*, then **Create Student**. Picking a class auto-fills the year level and academic year, and the server re-checks that the class really belongs to that level and year. The same tab lists the students with search, edit and deactivate.
- **Search** — search by student name, student ID, or class name.
- **Filter** — select a specific class cohort. Choosing *All Cohorts* clears the list rather than keeping the previous cohort on screen; a teacher must keep a class selected because teachers may only read their own assigned roster.
- **Sort** — toggle between alphabetical by name (default) or grouped by class.
- **Student profile** — **Profile** opens a modal with the full timeline (lesson records, monthly records, and significant pastoral observations).
- **Log Observation** — records a pastoral note against that specific student (date, category, severity, description, optional action taken and follow-up flag).
- **Terminology** — the school says **Year** (e.g., Year 7), never Grade: the **Years** management tab defines year levels, while **Academic Years** stays for calendar years like 2026-2027.

## Report workflow

Reports — legacy dated lesson reports and monthly records alike — run through one review machine. A legacy dated report carries a class, subject, lesson date within the organization's policy window and a topic; the server checks the year, term, assignment and active class roster (or the saved subject group), requires that roster and comments for improvement observations on submission, and commits the lesson and its observations in a single operation. Drafts and returned reports can be revised; approved reports are read-only for teachers. The admin reviews, approves or returns reports with a reason, can make reason-required date corrections, and can close/reopen months. Teachers may delete only their own drafts. Admins can activate/deactivate teachers (revoking their sessions), inspect student timelines, and review optional significant observations; super admins can reset primary-admin access (revoking sessions).

Monthly reports derive from submitted, under-review and approved observations by `lessonDate`. Student and lesson names are captured on new records so later renames do not relabel those historical reports. Closing a month freezes its calculation thresholds; reopening does not erase that snapshot. Reports show source counts and reject oversized unfiltered datasets instead of silently truncating. They show observation counts, topics, attendance, punctuality, significant comments and calculation-rule version. CSV and real XLSX workbook downloads and browser Print / Save as PDF are available. Student and teacher CSV/XLSX imports use preview, automatic column matching, explicit confirmation, server validation and an error CSV.

Report titles are consistent across output: student reports carry **`MONTHLY STUDENT ACADEMIC PROGRESS REPORT`** and class reports **`MONTHLY CLASS ACADEMIC PROGRESS REPORT`** in the PDF banner, the on-screen report eyebrow and the Excel export titles (`scripts/pdf.test.ts` locks this in).

## Monthly record entry

The monthly record is the only capture path: the teacher's **Monthly Record** entry (and each assignment card) opens the monthly form, and admins have the same page. There is no cadence switch anymore — `settings.reportingCadence` was dropped by migration `0006`, and the old dated form is gone from the UI while legacy dated rows stay readable in report history, student profiles and the review queue.

- One record per class, subject and calendar month: `sessionsHeld` and **Content Covered** at the top, then the roster with one **Punctuality & attendance** select per student (Always On Time, Occasionally Late, Frequently Late, Occasionally Absent, Frequently Absent) plus one level each for performance, participation, homework and conduct, and an optional comment. The category is stored as-is and expanded into session counts for reports (`punctualityCounts()`), so report attendance and §48 punctuality always match what was selected.
- The filing checklist (`view=monthlyEntries`) lists every assignment for the month with its status, **Missing** rows open a blank form. Submitting requires every student on the record's roster, non-empty **Content Covered**, a punctuality choice for every student and all four levels everywhere; a `NEEDS_IMPROVEMENT` performance/conduct level requires a comment. Unknown categories are rejected (400); months in the future or closed by the admin are rejected (409).
- **Subject groups (teacher-managed rosters):** the monthly form's **Manage students** button opens a club-style search + checkbox panel — the same pattern administrators use for club members — where the teacher ticks which students of the class take that subject. The saved group drives the form rows, the submit rule and report completion counts (`rosterCount`); saving an empty selection (or **Use whole class**) restores the default whole-class roster, so year levels that stream subjects later need no setup up front. Teachers can only manage groups for their own assignments and admins for any class (`saveSubjectRoster`, `view=subjectRoster`, table `subject_students`, migration `0007`). Classes are year-scoped, so each academic year starts fresh on the whole-class default.
- The workflow is the report review machine: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | RETURNED`, through the same admin review drawer and `review` action (`entityType: monthly_entry` in the audit log). Only drafts and returned records are editable; a returned record keeps its review note until it is resubmitted; teachers may delete only their own drafts/returned records.
- Monthly records flow into every report surface: `view=monthly` excludes that month's legacy dated rows for the same class+subject (a monthly record replaces them, never mixes) and expands the entry into one observation per held session; `view=reports` shows legacy and monthly rows together with a month tag; student profiles gain the monthly timeline row. Titles, thresholds, exports and PDFs are unchanged.
- **Class Reports ZIP** in the class summary toolbar (`buildClassReportsZip` in `src/lib/reportPdf.ts`, `jszip`) downloads one PDF per student of the class in a single ZIP.
- Scripts: `scripts/seed-monthly-demo.ts` seeds a demo month locally, `scripts/convert-legacy-lessons-to-monthly.ts` converts historical dated observations into monthly entries (idempotent).

## Clubs & activities

Co-curricular clubs live on the **Clubs** page, available to administrators and to teachers who are attached to a club.

- **Admin** creates and edits clubs (name, description, optional academic year), assigns teachers — the first one becomes the **teacher-in-charge** (`LEAD`) — and student members, records activities, and archives clubs (soft delete, restorable from the edit form). Archived clubs stay visible to admins.
- **Teacher** only sees the clubs they are assigned to, and can record, edit and submit activities for them, plus manage each club's student members from the **Manage members** panel on the club card. Creating/archiving clubs and reviewing are admin-only; teachers on other clubs cannot read those clubs at all. The super admin has no clubs screen.
- **Activity workflow** reuses the report review machine: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | RETURNED`. Returning or reopening requires a reason, approval happens only from `UNDER_REVIEW`, and editing a returned activity moves it back to `DRAFT` for correction. Only drafts and returned activities are editable or submittable.
- **Reports** — **Download club reports** builds one PDF per member (identity strip, KPI row, activity table, teacher comments, signatures). Its KPI row carries the child's **academic profile**: `PERFORMANCE`, `PUNCTUALITY`, `HOMEWORK` and `CONDUCT`, each printed on two lines — the headline result, then every rating as a **percentage of the ratings combined from all subjects** (10 ratings → 5 Needs Improvement, 3 Good, 2 Excellent reads `Needs Improvement 50%, Good 30%, Excellent 20%`). The window defaults to the active academic year (`Academic profile` in the strip) and comes from `view=clubProfiles`, which reads the same monthly-first/legacy-second observation merge as the main report so the headline matches the student report exactly. Available to administrators and to the teachers assigned to that club; without a profile the cards fall back to the club's own activity records.
- Every change is audited (`CLUB_CREATED`, `CLUB_UPDATED`, `CLUB_MEMBERS_UPDATED`, `CLUB_DEACTIVATED`, `CLUB_ACTIVITY_CREATED/UPDATED/RESUBMITTED_DRAFT/SUBMITTED` plus the `REPORT_*` review events), ids are checked against the organization on the server, and duplicate club names are rejected.

Data lives in `clubs`, `club_teachers`, `club_members` and `club_activities` (migration `0003`); the UI is `src/components/ClubsView.tsx`.

## Monthly reports, behaviour log and dashboards

- **Monthly Reports** — the read surface for the §193 records. Choose a period, then filter by class, subject, academic year, **term** and teacher; the comparison table shows one row per student-subject with month columns, colour-coded result pills and month-over-month arrows, and selecting a student opens the full on-screen report (performance, discipline, teacher comment, clubs, report information). Exports: per-student and per-subject Excel plus PDF (student report and whole-class ZIP). A term filter narrows the result to the term whose dates overlap each month.
- **Behaviour & Pastoral Care** — the school-wide log of pastoral observations. Each row shows date, student, class, category, severity, description, action taken, the teacher who filed it and a follow-up flag. **Follow-up required only** narrows the queue and **Resolve** clears the flag. Categories are `Behaviour`, `Academic`, `Homework`, `Participation`, `Punctuality`, `Other`; severities are `LOW`, `MODERATE`, `HIGH`; the date defaults to today's school date and must sit inside the organization's report window. Observations are recorded per student from the **Students** roster (**Log Observation**); the behaviour page's own button takes you to that roster. Administrators may resolve any follow-up, a teacher only their own.
- **Statistics** — academic and behavioural distribution analytics for a generated monthly report (counts and percentages per criterion, with Excel export). It prompts you to generate the monthly report first when there is nothing to analyse.
- **Data Quality** — the administrative integrity dashboard: draft and returned report queues over a chosen date range, with one-click navigation into the report.

### Rating mixes print as percentages

Every surface that shows a rating mix prints each rating as a **share of all ratings in that set**, largest first — `Needs Improvement 50%, Good 30%, Excellent 20%` for 5 / 3 / 2 out of 10 — never raw counts. That covers the student follow-up PDF and its on-screen report, the class summary (facts and month-by-month mixes), the per-subject and per-student Excel exports, the Monthly Reports perspective cards, and both club-report variants. Shares always total 100% per criterion, so the same subject data reads identically wherever it appears.

`npm run demo:reports` writes four sample PDFs to `demo/` (ignored by Git) so the layout can be inspected without a database: the student follow-up across ten subjects, the class summary, the club report driven by its academic profile, and the club report fallback that uses only club activity records.

## Entity management (Manage page)

The **Manage** tab lets administrators create, edit, search, and deactivate core entities:

- **Entity types**: Academic Years, Terms, Years, Classes, Subjects, Students, Teachers, Assignments.
- **Search/filter** — each entity list has a search box filtering by relevant fields (e.g., assignments by teacher, subject, class, year; students by name or student ID).
- **Edit** — inline modal updates any field; for assignments, changing the teacher/class/subject/year tuple **deactivates the old row** (preserving history) and creates a new active assignment. The old teacher's name is shown in the success toast as "removed from X".
- **Deactivate / Delete** — the trash action is only offered for entity types the server accepts:
  - Classes, Subjects, Terms, Years: soft deactivate (`active=false`).
  - Students: soft deactivate (`status='INACTIVE'`); a re-import never revives them.
  - Assignments: **hard delete** from `teacher_assignments`; audit log records the teacher, class, subject and year for traceability.
  - Clubs: archived from the **Clubs** page, not from here.
  - **Academic Years and Teachers have no delete.** Academic year deletion is refused by the API (years are the anchor of terms, classes and assignments); teachers are deactivated from **Edit → Active Status**, which also revokes their sessions.
- **Teacher password reset** — admin can reset a teacher's password from the list; new credentials shown once.
- **Terms** — a Term belongs to an academic year and carries its own start/end dates. Terms gate legacy dated reports (`saveMonthlyRecord` and admin date corrections refuse a date no active term covers) and drive the **Term** filter on the **Monthly Reports** page, where a month is matched to the term whose range overlaps it. Terms are optional for the §193 monthly workflow, which keys off calendar months and academic years.

## Security notes

Sessions are random server-stored tokens, hashed at rest, HttpOnly, SameSite=Lax and Secure in production. Passwords use bcrypt. Every password entry point shares one rule — **at least 6 characters with an uppercase letter, a lowercase letter, a number and a symbol** — enforced on the server for first-run setup, password change, admin create/reset and teacher create/reset, shown in the reset dialog (the confirm button stays disabled until the rule is met, with the failing part named inline), and satisfied by generated passwords (`src/lib/password.ts`, `src/lib/passwordSchema.ts`). Every signed-in user changes their own password from the top bar's **Change Password** button — the server revokes **every session for that account**, so the next step is signing in with the new password — and administrators rename their own username in **Settings → My Account**, where a name already taken by another account is rejected. Auth and data requests are server-authorized; teacher permissions use active assignments and tenant IDs taken from the authenticated session, never the payload. Failed-login throttling and origin checks are enabled. Audit entries record material changes. Keep `DATABASE_URL`, `SETUP_TOKEN`, passwords and all generated credentials out of version control. Distribute initial teacher passwords securely and require users to change them. CSV exports guard against formula injection.

## Audit log

The **Audit** page (admin only) shows a chronological trail of administrative and evaluation events:

- **User column** displays the actor's **username** (not a UUID).
- **Metadata Snapshot** column shows structured context (e.g., assignment deletion records the teacher, class, subject, academic year; reassignment records the new teacher).
- Actions include entity create/update/deactivate, report review transitions, month close/reopen, import, club activity lifecycle, date corrections, admin settings changes, and more.

## Database

The data layer is chosen at runtime by `src/db/index.ts`:

| Environment | Database | Configuration |
| --- | --- | --- |
| Local development (`npm run dev`) | SQLite file | `DATABASE_URL=file:./.data/local.db` in `.env`; the `.data/` folder is created automatically |
| Cloudflare deployment | D1 | the `DB` binding from `wrangler.jsonc` (`database_name: student-academic-reporting-db`); `DATABASE_URL` is ignored when the binding exists |

There is no PostgreSQL/MySQL dependency. Schema lives in `src/db/schema.ts`, generated SQL in `d1/migrations/`.

- Apply migrations locally: `npm run db:migrate` (drizzle-kit → `DATABASE_URL`).
- Apply migrations to D1: `npx wrangler d1 migrations apply student-academic-reporting-db --remote`.
- Migration status: `0003` adds the club tables (`clubs`, `club_teachers`, `club_members`, `club_activities`) and drops `teachers.department`; `0004` adds `monthly_entries` and `monthly_student_entries` (§193); `0005` adds `club_activity_records` (per-student club activity rows); `0006` renames `daily_lessons` → `monthly_lessons` and `daily_student_records` → `monthly_student_records` (column `daily_lesson_id` → `monthly_lesson_id`), renames the audit entity `daily_lesson` → `monthly_lesson` and drops `settings.reportingCadence`; `0007` adds `subject_students` (teacher-managed subject rosters). Migrations `0000`–`0007` are applied **both** locally and to the remote D1 database — check with `npx wrangler d1 migrations list student-academic-reporting-db --remote` (expect *No migrations to apply*). When you add a new migration, apply it to remote before deploying the build that expects it, so code and schema move together.
- Optional demo data (local only): `npm run db:seed`.
- Remove recorded legacy lesson data (local only): `npm run db:clear-records` — deletes `monthly_student_records` and `monthly_lessons`, keeping schools, users, classes, teachers, students, assignments and monthly records. Use `npx tsx scripts/clear-recorded-data.ts --dry-run` to preview the counts and `npx tsx scripts/clear-recorded-data.ts --sql` to print the statements for `npx wrangler d1 execute student-academic-reporting-db --remote --file clear-recorded-data.sql` when cleaning the deployed database.
- Back up a local database by copying `.data/local.db`; it is ignored by Git.

## Deployment

The runbook lives in [`deployment.md`](./deployment.md) — required setup, the **Verify before deploying** checklist, environment variables and rollback. Summary:

The app builds for Cloudflare Workers with OpenNext + Wrangler (`wrangler.jsonc`, main `.open-next/worker.js`, assets in `.open-next/assets`). The D1 `database_id` is already set to `student-academic-reporting-db` and all migrations `0000`–`0007` are applied remotely.

1. `npm install`
2. `npx wrangler login` (first time).
3. Walk the **Verify before deploying** checklist in `deployment.md`: `drizzle-kit generate` (no changes), remote migrations current, `SETUP_TOKEN` secret present, tests + smoke suites green, build succeeds, `wrangler deploy --dry-run` passes.
4. `npm run wrangler:deploy` — rebuilds and pushes the worker and assets to Cloudflare.
5. `npx wrangler deployments list --name student` to confirm the new version.
6. Local rehearsal of the production bundle: `npm run wrangler:dev` (needs `npx wrangler d1 migrations apply student-academic-reporting-db --local` once).

After deployment open `/` and complete **First-time setup** with `SETUP_TOKEN` to create the first super administrator. In production set a strong `SETUP_TOKEN` and `DATABASE_URL` only for local use; the D1 binding supplies the database.

Deployment notes:
- `.open-next/` and `.wrangler/` are build output — do not edit them by hand. They are ignored by Git (previously tracked `.open-next/` files were removed from the index), so always run `npm run build` immediately before `wrangler deploy` and never rely on the repository to hold a bundle.
- Apply migrations to the remote database before the deploy that needs them: `npx wrangler d1 migrations apply student-academic-reporting-db --remote` — code and schema move together (the migration list is in the *Database* section above; all are currently applied remotely).
- Set secrets per environment with `npx wrangler secret put SETUP_TOKEN` (`SETUP_TOKEN` is already set on the `student` worker; without it, first-time setup stays disabled). `TEACHER_INITIAL_PASSWORD` is intentionally **not** set, so imported teachers start on the built-in `school123` — see `deployment.md`.
- The app reads the D1 binding from the Cloudflare request context at runtime; without it (for example in a plain Node server) it falls back to `DATABASE_URL`.


## Organization logo

Logos are per organization — several organizations can share one deployment and each keeps its own image.

1. **Settings → Organization → Logo URL (admin)**, or the super-admin organization form, has an **Upload logo file** picker: PNG, JPG, WebP or SVG up to 200 KB. The file is stored with that organization only (as a data URI in `organizations.logo_url`), then **Save** applies it. The preview and **Remove logo** button sit under the picker.
2. Alternatively paste a full `https://…` image URL, or the site path of a file in `public/`. The default for new organizations is `/icons/school_logo.png` (`public/icons/school_logo.png`).
3. Where it appears: the sidebar (signed in, the current organization's logo), and the sign-in screen. The sign-in screen resolves the logo while you type: an email address matches the organization of accounts using that domain (or `organizations.domain`), and single-organization deployments show their logo for any identifier. With no match it falls back to `/icons/school_logo.png`, then to the default icon.