# Wellspring — school daily reporting

A multi-organization daily academic and behavioural reporting application. Next.js App Router, TypeScript, Drizzle ORM, SQLite/D1, bcryptjs, server-side sessions and Zod. Daily records produce deterministic monthly summaries. No timetable, evidence uploads, or external AI dependency.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a local SQLite file such as `./.data/local.db`, plus a long random `SETUP_TOKEN`.
3. For local SQLite development, initialize a local file-based database and run `npx drizzle-kit migrate` to apply the schema. For Cloudflare deployment, use Wrangler D1 and `wrangler d1 migrations apply` instead of a PostgreSQL server.
4. `npm run dev` and open `/`. Choose **First-time setup** and enter the environment setup token to create the first super administrator. Setup is rejected once any user exists. Do not publish the setup token.
5. Super admin creates an organization and its primary admin. Admin creates academic years, terms, classes, subjects, teachers, students, and assignments in that order.

For local-only sample data, the demo seed remains available, but it should be treated as disposable and not as the default application login. Use the setup flow to create your own administrator and keep the real credentials in a local file such as `logins.text`, which is ignored by Git.

Run business-rule tests: `npx tsx --test scripts/rules.test.ts`.

## Excel / CSV import format

The app supports bulk import for students, teachers, and teacher assignments from Excel `.xlsx` or CSV files.

### Students

Use a header row exactly like this:

| Student ID | Student Name | Grade | Class | Academic Year | Status |
| --- | --- | --- | --- | --- | --- |
| STU-1001 | Alice Niyonkuru | Grade 7 | 7A | 2026-2027 | ACTIVE |

Notes:
- `Student Name` should be the full name in one cell.
- `Grade`, `Class`, and `Academic Year` must match existing admin records.
- `Status` is optional and defaults to `ACTIVE` when blank.

### Teachers

| Teacher ID | Teacher Name | Email | Department |
| --- | --- | --- | --- |
| T-001 | John Mugabo | john@school.com | Mathematics |

Notes:
- Email must be unique in the organization.
- The system creates the teacher account and the admin can reset the password later if needed.

### Combined teacher roster and assignment upload

This is the format you can use when a teacher sheet includes each teacher and the class/subject information in the same document:

| NO | NAME | SURNAME | CONTACT DETAIL | NATIONALITY | EMAIL | SUBJECTS | CLASSES |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | John | Mugabo | +250788123456 | Burundian | john@school.com | Mathematics, ICT | 7A, 8A |

How it works:
- The system reads each teacher row and creates or updates the teacher.
- Each value in `SUBJECTS` and `CLASSES` is treated as a separate subject/class assignment.
- `CLASSES` can include class names such as `7A`, `8A`, or `Grade 7A` depending on your database naming.
- The app maps each teacher to the matching class and subject records already created in the school setup.
- This lets you upload a single document with teachers and their assigned classes instead of using a separate assignment-only sheet.

### Teacher assignments

| Teacher Email | Class | Subject | Academic Year | Active |
| --- | --- | --- | --- | --- |
| john@school.com | 7A | Mathematics | 2026-2027 | TRUE |

Notes:
- `Teacher Email` must match an existing teacher in the org.
- `Class`, `Subject`, and `Academic Year` must already exist.
- `Active` can be `TRUE` or `FALSE`.

The import flow validates rows before commit, flags invalid entries, and lets the admin download an error CSV when a batch contains problems.

## Daily workflow

The teacher selects an assigned class and subject, a lesson date within the previous 14 calendar days in the organization's timezone, and a topic. The server checks the year, term, assignment and active class roster. **Set all normal** fills present/good/active/completed/good. Absent students have null academic fields. Submission requires the full roster and comments for improvement observations. A single server operation commits the lesson and observations. Drafts and returned reports can be revised; approved reports are read-only for teachers. The admin reviews, approves or returns reports with a reason, can make reason-required date corrections, and can close/reopen months. Teachers may delete only their own drafts. Admins can activate/deactivate teachers (revoking their sessions), inspect student timelines, and review optional significant observations; super admins can reset primary-admin access (revoking sessions).

Monthly reports derive from submitted, under-review and approved observations by `lessonDate`. Student and lesson names are captured on new records so later renames do not relabel those historical reports. Closing a month freezes its calculation thresholds; reopening does not erase that snapshot. Reports show source counts and reject oversized unfiltered datasets instead of silently truncating. They show observation counts, topics, attendance, punctuality, significant comments and calculation-rule version. CSV and real XLSX workbook downloads and browser Print / Save as PDF are available. Student and teacher CSV/XLSX imports use preview, column mapping, explicit confirmation, server validation and an error CSV.

## Security notes

Sessions are random server-stored tokens, hashed at rest, HttpOnly, SameSite=Lax and Secure in production. Passwords use bcrypt. Auth and data requests are server-authorized; teacher permissions use active assignments and tenant IDs taken from the authenticated session, never the payload. Failed-login throttling and origin checks are enabled. Audit entries record material changes. Keep `DATABASE_URL`, `SETUP_TOKEN`, passwords and all generated credentials out of version control. Distribute initial teacher passwords securely and require users to change them. CSV exports guard against formula injection.

## Deployment constraint

**This implementation is prepared for SQLite/D1 with Wrangler deployment.** The app prefers the Cloudflare D1 binding when available and falls back to a local SQLite file for development. The database layer is no longer tied to PostgreSQL.
# academic_progress_tracker
