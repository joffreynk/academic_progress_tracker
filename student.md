# FINAL MASTER ENGINEERING PROMPT

## SECURE, FAST, MULTI-ORGANIZATION SCHOOL DAILY STUDENT ACADEMIC & BEHAVIOURAL REPORTING PLATFORM

You are a senior software architect, security engineer, full-stack engineer, database engineer, DevOps engineer, QA engineer, and UI/UX engineer.

Build a **real production-ready application** for an international school to record daily student academic and behavioural observations and automatically produce monthly reports and statistics.

This is NOT a mockup.

This is NOT a static frontend.

This is NOT a toy CRUD application.

This is NOT a fake dashboard with hard-coded numbers.

All core workflows must work end-to-end with a real database and real authentication.

The application must be secure, multi-tenant, fast, responsive, maintainable, auditable, and deployable to Cloudflare.

---

# 1. PRODUCT OBJECTIVE

The application replaces the school's manual monthly student follow-up process with a continuous digital recording system.

Teachers do NOT manually create a long monthly report.

Instead:

1. A teacher logs in.
2. The teacher sees their assigned class/subject combinations.
3. The teacher chooses the class.
4. The teacher chooses the subject assigned to that class.
5. The teacher chooses the actual teaching/observation date.
6. The application automatically loads the active students in that class.
7. The teacher records one class report for that date/subject.
8. The teacher can save a draft.
9. The teacher can submit the completed class report.
10. The system stores the lesson record and associated student records.
11. The system accumulates daily data throughout the month.
12. The system calculates monthly statistics.
13. The system generates monthly reports by student, subject, class, and organization.

The system is designed around **daily evidence in structured data**, while the monthly report is an automatically calculated output.

---

# 2. CRITICAL DATE RULE

This is a mandatory business rule.

A teacher must be allowed to select the **actual date on which the lesson/reporting event occurred**.

The selected date:

* MUST NOT be in the future.
* MUST NOT be older than 14 calendar days from today.
* MAY be today.
* MAY be any date from today backwards through exactly 14 calendar days.

Therefore:

`minimumAllowedLessonDate = schoolToday - 14 calendar days`

`maximumAllowedLessonDate = schoolToday`

Example:

If today is:

`28 September 2026`

the allowed lesson-date range is:

`14 September 2026` through `28 September 2026`

inclusive.

The teacher may therefore enter a lesson from several days ago if they were too busy to enter it immediately.

Do NOT allow a teacher to enter a lesson older than 14 days.

Do NOT allow future lesson dates.

Do NOT use `createdAt` as the teaching date.

Use:

`lessonDate`

for the actual teaching/reporting date.

Store separately:

`createdAt`

`updatedAt`

`submittedAt`

The monthly report MUST use `lessonDate`.

---

# 3. TIMEZONE RULE

The school must have a configurable timezone.

Default seed:

`Africa/Bujumbura`

Do not rely on the browser's local timezone for security-sensitive date validation.

The server must determine "today" using the organization's configured timezone.

The 14-day rule must be evaluated server-side.

Client-side date restrictions are only for usability and MUST NOT be trusted for authorization/validation.

---

# 4. NO TIMETABLE

There is deliberately NO timetable system in this release.

Do NOT build:

* period schedules
* lesson slots
* weekly timetable
* scheduled lesson synchronization
* calendar-based timetable
* teacher schedule enforcement
* automatic "you should have taught today" logic

A teacher is free to enter records whenever they have time.

The only date restriction is:

`today - 14 days <= lessonDate <= today`

subject to organization timezone.

---

# 5. TEACHER ASSIGNMENT MODEL

This is a critical part of the design.

A teacher may:

* teach multiple classes
* teach multiple subjects
* teach different subjects in different classes

Examples:

Teacher John:

* Grade 7A → Mathematics
* Grade 8A → Mathematics
* Grade 10B → Physics
* Grade 11A → Physics
* Grade 9C → Global Citizenship

Teacher Sarah:

* Grade 7A → English
* Grade 8B → English
* Grade 9A → Global Citizenship
* Grade 9B → English

Do NOT assume:

`one teacher = one subject`

Do NOT assume:

`one teacher = one class`

Do NOT assume:

`one class = one teacher`

The authoritative relationship is:

`Teacher + Class + Subject + Academic Year`

---

# 6. ROLES

Implement exactly these primary roles:

## SUPER_ADMIN

Global organization manager.

Can:

* create organizations
* edit organizations
* activate/deactivate organizations
* create organization Admin
* replace organization Admin
* reset organization Admin access
* view organization list
* view high-level organization statistics
* manage global configuration
* view global audit logs
* access organization administration context when explicitly selected

SUPER_ADMIN is global and does not belong to one normal school organization.

---

## ADMIN

Organization-level administrator.

Each organization has one primary Admin in this release.

Admin can manage ONLY their own organization.

Can manage:

* students
* teachers
* grades
* classes
* subjects
* academic years
* terms
* teacher assignments
* reporting settings
* user activation/deactivation
* imports
* exports
* daily reports
* report review
* report approval
* report return
* monthly reports
* statistics
* audit logs
* organization settings

Admin cannot manage another organization.

---

## TEACHER

Teacher belongs to one organization.

Teacher permissions are determined by active teacher assignments.

Teacher can:

* access dashboard
* view assigned classes
* view assigned subjects
* view authorized students
* create reports
* save drafts
* submit reports
* edit own drafts
* correct returned reports
* view own reporting history
* view authorized monthly reports
* download authorized reports

Teacher cannot:

* create users
* change roles
* create organizations
* assign teachers
* change students globally
* modify subjects globally
* modify classes globally
* alter reporting rules
* access other organizations
* access unrelated classes
* access unrelated subjects
* edit another teacher's approved report

---

# 7. MULTI-TENANCY

The application must be truly multi-tenant.

Every organization-owned database entity must contain:

`organizationId`

At minimum:

* users
* teachers
* students
* grades
* classes
* subjects
* academic years
* terms
* teacher assignments
* daily lessons
* daily student records
* behaviour observations
* audit logs
* settings
* report records if persisted

The application MUST enforce organization isolation on the server.

Never trust:

`organizationId`

supplied by the browser.

The server must obtain the authenticated user's organization and use that as the tenant boundary.

A malicious teacher must not be able to access another organization by changing:

* URL IDs
* query parameters
* form fields
* request bodies
* route parameters
* API payloads
* hidden form fields

Protect against IDOR/BOLA.

---

# 8. SECURITY IS A FIRST-CLASS REQUIREMENT

Treat student data as sensitive school information.

Security must be designed before UI convenience.

Implement:

* secure authentication
* strong password hashing
* secure sessions
* secure cookies
* role-based authorization
* object-level authorization
* tenant isolation
* server-side validation
* input validation
* Zod validation
* rate limiting/throttling where practical
* brute-force protection
* CSRF-safe architecture
* XSS protection
* SQL injection protection through parameterized queries/ORM
* security headers
* Content Security Policy where compatible
* Referrer-Policy
* X-Content-Type-Options
* frame protection
* secure origin handling
* no secrets in source code
* no password logging
* audit logging
* safe error handling

Never reveal internal stack traces to users.

Never reveal database queries.

Never expose secrets through API responses.

---

# 9. AUTHENTICATION

Use the latest stable Auth.js / NextAuth-compatible architecture supported by the selected Next.js version and Cloudflare deployment architecture.

Do not blindly copy outdated NextAuth tutorials.

Use a Cloudflare-compatible authentication strategy.

Support:

* username + password
* email + password
* logout
* password change
* Admin password reset
* account activation/deactivation
* session expiration

Never store plaintext passwords.

Use a secure password hashing implementation compatible with Cloudflare Workers.

Do not use Node-only native modules that will fail in the Cloudflare runtime.

Never put password hashes into client-side state.

---

# 10. SESSION SECURITY

Sessions must include only necessary identity data.

Use:

* user ID
* role
* organization ID where applicable
* teacher ID where applicable

Do not put sensitive student data into sessions.

Use secure cookies.

Production cookies must use:

`Secure`

and appropriate:

`HttpOnly`

and:

`SameSite`

settings.

Prevent session fixation.

Invalidate sessions appropriately on logout.

Consider session invalidation after account deactivation.

---

# 11. LOGIN SECURITY

Implement:

* failed-login throttling
* reasonable brute-force protection
* generic invalid-login messages
* no username/email enumeration through error messages
* audit logging for authentication events

Do not reveal whether an account exists through password-reset or login error messages.

---

# 12. CLOUDflare ARCHITECTURE

Target:

Cloudflare Workers

Use:

* latest stable Next.js compatible with Cloudflare
* current Cloudflare-supported Next.js/OpenNext deployment approach
* TypeScript
* Drizzle ORM
* Cloudflare D1

Production database:

`Cloudflare D1`

D1 is the production SQLite database.

DO NOT use:

`database.sqlite`

as a persistent production database file.

DO NOT depend on:

* persistent local filesystem
* a traditional Node.js server
* VPS
* long-running Express server
* filesystem-based production database

Local development may use Cloudflare local development tooling and a compatible local D1 database.

---

# 13. KEEP PRODUCTION CLOUDFLARE-FREE-TIER COMPATIBLE

Design the core application to avoid requiring paid-only infrastructure.

Do not make these mandatory:

* paid external database
* paid Redis
* paid vector database
* paid AI API
* paid email provider
* paid storage provider

The core application must function without any external paid service.

Use only required Cloudflare capabilities and the application's D1 database.

---

# 14. NO FILE UPLOADS

This version has NO evidence or proof upload functionality.

Do NOT implement:

* R2
* evidence uploads
* proof uploads
* student attachments
* teacher attachments

The application only stores structured reporting data.

Generated reports may be dynamically downloaded.

---

# 15. DATABASE DESIGN

Use Drizzle ORM with D1.

Use relational normalization.

Create the following core tables.

---

## organizations

Fields:

* id
* name
* code
* domain optional
* logoUrl optional
* timezone
* active
* primaryAdminUserId
* createdAt
* updatedAt

Organization code must be unique.

Default timezone:

`Africa/Bujumbura`

Admin must be able to change it.

---

## users

Fields:

* id
* organizationId nullable for SUPER_ADMIN
* username
* email
* name
* passwordHash
* role
* active
* createdAt
* updatedAt
* lastLoginAt

Roles:

* SUPER_ADMIN
* ADMIN
* TEACHER

For this release, an organization should normally have one primary ADMIN.

Protect against accidental creation of multiple primary Admins unless explicitly supported.

---

## teachers

Fields:

* id
* organizationId
* userId
* teacherId
* name
* email
* department optional
* active
* createdAt
* updatedAt

Unique:

`organizationId + teacherId`

---

## students

Fields:

* id
* organizationId
* studentId
* firstName
* lastName
* fullName
* gradeId
* classId
* academicYearId
* status
* createdAt
* updatedAt

Unique:

`organizationId + studentId`

Student IDs must be stable.

Do not use student name as identity.

---

## grades

Fields:

* id
* organizationId
* name
* orderIndex
* active

Seed:

Grade 1 through Grade 13.

Admin may add/edit grades.

---

## classes

Fields:

* id
* organizationId
* gradeId
* academicYearId
* name
* active
* createdAt
* updatedAt

Examples:

7A
7B
8A
8B
10B
11A

Unique within organization/year:

`organizationId + academicYearId + name`

---

## subjects

Fields:

* id
* organizationId
* code
* name
* active
* createdAt
* updatedAt

Seed the subjects appearing in the school's current reporting form:

* English
* Mathematics
* Science
* Computing
* Global Citizenship
* French
* Turkish
* Kirundi

Also support subjects such as:

* Physics

Do not permanently hard-code the subject list.

---

## academic_years

Fields:

* id
* organizationId
* name
* startDate
* endDate
* active

Example:

2026-2027

---

## terms

Fields:

* id
* organizationId
* academicYearId
* name
* startDate
* endDate
* active

---

# 16. TEACHER ASSIGNMENTS TABLE

Create:

## teacher_assignments

Fields:

* id
* organizationId
* teacherId
* classId
* subjectId
* academicYearId
* active
* createdAt
* updatedAt

This is the authoritative table that determines what a teacher is permitted to report.

Example:

| Teacher | Class | Subject            |
| ------- | ----- | ------------------ |
| John    | 7A    | Mathematics        |
| John    | 8A    | Mathematics        |
| John    | 10B   | Physics            |
| John    | 11A   | Physics            |
| John    | 9C    | Global Citizenship |

The system must never assume a teacher teaches every class or every subject.

---

# 17. AUTHORIZATION BASED ON ASSIGNMENTS

Before creating or editing any daily report, verify server-side:

1. authenticated user is a teacher
2. teacher is active
3. teacher belongs to current organization
4. class belongs to current organization
5. subject belongs to current organization
6. academic year belongs to current organization
7. active teacher assignment exists for:

teacher + class + subject + academic year

Never accept the assignment as a client-side assumption.

---

# 18. DAILY LESSON TABLE

Create:

## daily_lessons

One row represents one class/subject reporting event.

Fields:

* id
* organizationId
* teacherId
* classId
* subjectId
* academicYearId
* termId
* lessonDate
* topic
* status
* createdAt
* updatedAt
* submittedAt
* reviewedAt
* reviewedBy
* reviewComment

Statuses:

* DRAFT
* SUBMITTED
* UNDER_REVIEW
* APPROVED
* RETURNED

Uniqueness:

`organizationId + teacherId + classId + subjectId + lessonDate`

Prevent duplicate class/subject/date reports.

---

# 19. DAILY STUDENT RECORDS

Create:

## daily_student_records

Fields:

* id
* organizationId
* dailyLessonId
* studentId
* attendanceStatus
* performance
* participation
* homework
* conduct
* comment
* createdAt
* updatedAt

Unique:

`dailyLessonId + studentId`

---

# 20. ONE TEACHER FORM

Although the database uses:

`daily_lessons`

and:

`daily_student_records`

teachers MUST see only ONE unified form.

The teacher experience:

## DAILY CLASS REPORT

Date
[ 24/09/2026 ]

Class
[ Grade 7A ▼ ]

Subject
[ Mathematics ▼ ]

Topic
[ Fractions __________________ ]

Then automatically display the class roster.

---

# 21. CLASS FILTERING

When a teacher chooses a class:

load ONLY active students where:

* organizationId = teacher's organization
* classId = selected class
* academicYearId = current/selected academic year
* status = ACTIVE

Do not load all students into the browser.

Example:

Students table:

Aline → 7A
David → 7A
Eric → 7A
Sarah → 7B
Jean → 7B

Teacher selects:

7A

Display:

Aline
David
Eric

Do NOT display:

Sarah
Jean

---

# 22. SUBJECT FILTERING

When teacher selects class 7A:

show only subjects where an active assignment exists:

teacher + 7A + subject

Example:

Teacher John:

7A → Mathematics
7A → Physics

The subject dropdown must show:

Mathematics
Physics

For 10B:

if John only teaches Physics:

show only:

Physics

Never show unrelated subjects.

---

# 23. DATE SELECTION IN THE FORM

The date selector must be clearly visible.

Display:

`Lesson Date`

with minimum and maximum enforced.

Maximum:

today according to organization timezone.

Minimum:

today minus 14 calendar days.

Example:

Today = 28/09/2026

Allowed:

14/09/2026 – 28/09/2026

Do NOT allow:

13/09/2026

Do NOT allow:

29/09/2026

The UI should disable invalid dates.

The server MUST independently enforce the same rule.

---

# 24. "DATE ALIGNED WITH TAUGHT SUBJECT"

The system must make the relationship explicit:

Teacher
+
Class
+
Subject
+
Lesson Date

The lesson date selected by the teacher represents when that specific subject was taught/observed for that particular class.

Example:

John selects:

Class = 7A
Subject = Mathematics
Lesson Date = 22 September
Topic = Fractions

That report is:

`22 September — Grade 7A — Mathematics`

If John also taught Physics to 10B on 22 September:

`22 September — Grade 10B — Physics`

These are separate reports.

---

# 25. NO TIMETABLE VALIDATION

Do NOT check whether Mathematics was "scheduled" on 22 September.

Do NOT block the teacher because no timetable exists.

Only verify:

* teacher assignment
* valid date range
* class
* subject
* student roster
* duplicate protection

---

# 26. DAILY RECORDING UI

Design the class reporting interface for speed.

Example:

---

## DAILY CLASS REPORT

Lesson Date:
[ 22 September 2026 ]

Class:
[ Grade 7A ▼ ]

Subject:
[ Mathematics ▼ ]

Topic:
[ Fractions __________________________ ]

[ SET ALL NORMAL ]

---

## STUDENTS

Aline N.

Attendance       [ Present ▼ ]
Performance      [ Good ▼ ]
Participation    [ Active ▼ ]
Homework         [ Completed ▼ ]
Conduct          [ Good ▼ ]

---

David K.

Attendance       [ Present ▼ ]
Performance      [ Needs Improvement ▼ ]
Participation    [ Passive ▼ ]
Homework         [ Not Completed ▼ ]
Conduct          [ Good ▼ ]

Comment:
[ Difficulty understanding fractions ]

---

Eric M.

Attendance       [ Absent ▼ ]

---

[ SAVE DRAFT ]        [ SUBMIT CLASS REPORT ]

---

---

# 27. SET ALL NORMAL

Provide:

`SET ALL NORMAL`

Default:

Attendance = Present
Performance = Good
Participation = Active
Homework = Completed
Conduct = Good

Then teacher changes only exceptions.

This is a critical usability feature.

Example:

30 students.

Set all normal.

Teacher changes:

David → Needs Improvement
Mary → Moderate participation
John → Excellent
Eric → Absent

Then submit.

---

# 28. ATTENDANCE — EXACTLY THREE STATUSES

The new school form requires exactly:

`PRESENT`

`LATE`

`ABSENT`

Do NOT include Excused for this release.

Do NOT include Unexcused for this release.

Do NOT include Other.

Teacher must choose one of:

Present
Late
Absent

---

# 29. ABSENT STUDENT LOGIC

When:

Attendance = ABSENT

normally disable:

* Performance
* Participation
* Homework
* Conduct

because the student was not present for that lesson.

Do not automatically record academic performance for absent students.

Store those fields as null unless school configuration explicitly changes this behaviour.

---

# 30. LATE STUDENT LOGIC

When:

Attendance = LATE

the student participated in the lesson.

They may therefore have:

* Performance
* Participation
* Homework
* Conduct

recorded.

Monthly punctuality is derived from Late records.

---

# 31. PERFORMANCE

Daily choices:

* Excellent
* Good
* Needs Improvement

These come from the school's reporting form.

Use enum values internally:

EXCELLENT
GOOD
NEEDS_IMPROVEMENT

---

# 32. PARTICIPATION

Daily choices:

* Active
* Moderate
* Passive

These correspond to the school's form.

Internal enum:

ACTIVE
MODERATE
PASSIVE

---

# 33. HOMEWORK

Daily choices:

* Completed
* Not Completed
* Not Applicable

The monthly output must derive:

* Always Completed
* Usually Completed
* Rarely Completed

using configurable thresholds based on actual records.

The school's form uses these monthly homework categories.

---

# 34. CONDUCT

Daily choices:

* Excellent
* Good
* Needs Improvement

Used for monthly class-conduct calculation.

The final report follows the school's Discipline & School Conduct section.

---

# 35. COMMENTS

Teacher comments should normally be optional.

Make comment required when:

Performance = Needs Improvement

or:

Conduct = Needs Improvement

or when Admin-configured rules require it.

Do NOT require comments for every student every day.

This keeps the application practical for teachers.

---

# 36. FULL CLASS SUBMISSION RULE

A submitted class report should represent the entire active class roster.

If class has:

30 active students

then the submitted report must have:

30 daily student records.

Absent students must still receive:

Attendance = Absent

Do not allow a submitted report to silently omit students.

Drafts may be incomplete.

Submitted reports should be complete.

---

# 37. DRAFT FUNCTIONALITY

Provide:

`SAVE DRAFT`

A draft may contain incomplete records.

Teacher can return later within the allowed date/reporting policy.

Show:

* class
* subject
* lesson date
* topic
* completion %
* last updated
* status

Actions:

`CONTINUE`

`DELETE`

`SUBMIT`

---

# 38. BACKDATED REPORTS

Teacher may select any valid lesson date within:

today - 14 days

through today.

Example:

Today:

28 September

Teacher may enter:

25 September
24 September
22 September
15 September
14 September

But not:

13 September

and not:

29 September

This rule must be enforced on the server.

---

# 39. ADMIN OVERRIDE FOR OLD RECORDS

By default, teachers may not create lessons older than 14 days.

Admin may have a controlled correction workflow for exceptional cases.

Do NOT simply give teachers an unrestricted date override.

If Admin needs to create or correct an older record:

* use an explicit Admin action
* require reason
* record audit log
* identify administrator
* timestamp action

This protects data integrity.

---

# 40. DUPLICATE PREVENTION

For a teacher:

`teacher + class + subject + lessonDate`

must represent one daily report.

If a teacher tries to create the same report again:

show:

`A report for this class, subject and date already exists.`

Options:

`Open Existing Report`

Do not silently create another.

---

# 41. REPORT REVIEW WORKFLOW

Teacher:

DRAFT
→ SUBMITTED

Admin:

SUBMITTED
→ UNDER REVIEW
→ APPROVED

or:

SUBMITTED
→ RETURNED

Returned report:

* contains review reason
* appears in teacher's dashboard
* can be corrected
* can be resubmitted

Approved report:

* cannot normally be changed by Teacher
* may be reopened by Admin
* reopening must create an audit record

---

# 42. MONTHLY AGGREGATION

Monthly results must be calculated from daily student records.

For each:

Organization
+
Academic Year
+
Term
+
Month
+
Student
+
Subject

calculate:

* lesson/report count
* Present count
* Late count
* Absent count
* performance counts
* participation counts
* homework counts
* conduct counts
* topics covered
* important comments

Do not use manual monthly teacher entry.

---

# 43. MONTH CLASSIFICATION

A daily record belongs to a month based on:

`lessonDate`

NOT:

`createdAt`

NOT:

`updatedAt`

NOT:

`submittedAt`

Example:

Lesson date:
20 September

Teacher enters:
26 September

The record belongs to:

September

---

# 44. PERFORMANCE SCORING

Default internal scores:

Excellent = 3
Good = 2
Needs Improvement = 1

Build configurable thresholds in Admin settings.

The exact thresholds must not be hard-coded permanently.

For each subject/month display both:

* monthly result
* underlying counts

Example:

Excellent: 2
Good: 11
Needs Improvement: 5

Monthly Result:
Needs Improvement

Do not display only the final label without supporting statistics.

---

# 45. PARTICIPATION SCORING

Default:

Active = 3
Moderate = 2
Passive = 1

Use configurable aggregation.

Show counts and final monthly result.

---

# 46. CONDUCT SCORING

Default:

Excellent = 3
Good = 2
Needs Improvement = 1

Use configurable aggregation.

---

# 47. HOMEWORK MONTHLY CALCULATION

Based on completed vs not completed observations.

Default suggested thresholds:

Always Completed:
100%

Usually Completed:
80% to less than 100%

Rarely Completed:
below 80%

Store these as Admin-configurable settings.

Do not permanently hard-code them.

---

# 48. PUNCTUALITY CALCULATION

Daily attendance has:

Present
Late
Absent

Monthly punctuality should derive from Late records.

Default:

Always On Time:
zero Late records

Occasionally Late:
more than 0 and <= 10% late rate among attended lessons

Frequently Late:
more than 10%

Make these thresholds configurable.

The monthly output should use the school's existing wording:

* Always On Time
* Occasionally Late
* Frequently Late

---

# 49. ATTENDANCE MONTHLY RESULT

Calculate:

Present
Late
Absent

Do NOT merge Late into Present in the displayed counts.

Attendance percentage:

`(Present + Late) / (Present + Late + Absent) * 100`

Display the underlying counts.

The new form specifically asks for Present, Late coming, and Absent.

---

# 50. TOPICS COVERED

Aggregate unique topics for:

Student + Subject + Month

Example:

Mathematics:

* Fractions
* Equivalent Fractions
* Algebra
* Linear Equations

Remove duplicate identical topics.

---

# 51. IMPORTANT OBSERVATIONS

Do not dump every daily comment into the monthly report.

Identify significant records:

* Needs Improvement
* conduct concerns
* repeated problems
* important academic comments
* important homework concerns
* important participation concerns

Display these in a concise monthly section.

Provide a separate daily history for complete detail.

---

# 52. INDIVIDUAL STUDENT MONTHLY SUBJECT REPORT

Admin/authorized teacher selects:

Student:
David K.

Subject:
Mathematics

Month:
September 2026

Display:

## Student Information

* Student name
* Student ID
* Grade
* Class
* Academic year
* Term
* Month

## Subject

Mathematics

## Topics Covered

...

## Performance

Monthly Result

Excellent count
Good count
Needs Improvement count

## Participation

Monthly Result

Active count
Moderate count
Passive count

## Homework

Monthly Result

Completed count
Not Completed count

## Conduct

Monthly Result

## Attendance

Present
Late
Absent
Attendance %

## Important Observations

...

---

# 53. FULL STUDENT MONTHLY REPORT

Generate:

Student
+
Month
+
All applicable subjects

For each subject:

* topic(s)
* performance
* participation
* homework
* conduct
* attendance

Then overall monthly student information.

This should follow the structure of the school's current monthly form.

---

# 54. CLASS MONTHLY SUBJECT REPORT

Example:

Grade 7A
Mathematics
September 2026

Display:

| Student | Lessons | Present | Late | Absent | Performance | Participation | Homework | Conduct |
| ------- | ------: | ------: | ---: | -----: | ----------- | ------------- | -------- | ------- |

Allow:

* sort
* search
* filters

Downloads:

* PDF
* Excel
* CSV

---

# 55. FULL CLASS MONTHLY REPORT

Example:

Grade 7A
September 2026

Include all configured subjects relevant to the class.

Provide:

* student-level summaries
* subject summaries
* class statistics

Downloads:

* PDF
* Excel

---

# 56. STUDENT REPORT DOWNLOADS

For individual student:

`Download Subject Monthly PDF`

`Download Subject Monthly Excel`

`Download Full Monthly PDF`

`Download Full Monthly Excel`

The download must contain actual generated data.

No placeholder files.

---

# 57. CLASS REPORT DOWNLOADS

For class:

`Download Subject Monthly PDF`

`Download Subject Monthly Excel`

`Download Full Class Monthly PDF`

`Download Full Class Monthly Excel`

---

# 58. REPORT PRINTING

Provide a print-friendly report page.

The final report must be suitable for:

* school records
* parent communication
* administration
* printing

Use clean pagination.

Use the school name and logo if configured.

---

# 59. PDF ARCHITECTURE

The application must run on Cloudflare Workers.

Avoid server-side Chromium/Puppeteer unless proven compatible with the selected deployment runtime.

Prefer a Cloudflare-compatible report generation architecture.

If true PDF generation is technically unsuitable in the Worker runtime, provide:

* print-ready HTML
* browser "Print / Save as PDF"
* Excel download

without breaking the application.

Do not make the application dependent on an incompatible PDF engine.

---

# 60. EXCEL IMPORT

Admin can import existing student and teacher Excel files.

Support:

* XLSX
* CSV

Student import fields:

* Student ID
* Student Name
* Grade
* Class
* Academic Year
* Status

Teacher import fields:

* Teacher ID
* Teacher Name
* Email
* Department

---

# 61. EXCEL IMPORT SAFETY

Do not import immediately.

Workflow:

UPLOAD
→ PREVIEW
→ COLUMN MAPPING
→ VALIDATION
→ DUPLICATE CHECK
→ CONFIRM
→ IMPORT

Show:

Imported
Updated
Skipped
Errors

Allow downloading an error CSV.

Do not silently discard invalid rows.

---

# 62. TEACHER ASSIGNMENT IMPORT

Support CSV/XLSX import:

Teacher Email
Class
Subject
Academic Year
Active

Example:

[john@schooldomain.org](mailto:john@schooldomain.org) | 7A | Mathematics | 2026-2027 | Yes

The system must validate that:

* teacher exists
* class exists
* subject exists
* academic year exists
* all belong to same organization

---

# 63. DATA MODEL FOR HISTORICAL ACCURACY

Historical records must remain correct if:

* student changes class
* teacher becomes inactive
* teacher assignment changes
* class becomes inactive
* subject becomes inactive
* academic year closes

Do not reconstruct historical reports solely from today's student class.

Historical daily lesson records store:

* class
* subject
* teacher
* academic year

so the original context remains intact.

---

# 64. ORGANIZATION SETTINGS

Admin can configure:

* school name
* logo
* timezone
* academic year
* term
* grades
* classes
* subjects
* performance thresholds
* homework thresholds
* punctuality thresholds
* report rules
* month closing settings
* future-date permission if ever needed

The standard default must remain:

* maximum date = today
* minimum date = today minus 14 days

---

# 65. SUPER ADMIN ORGANIZATION MANAGEMENT

Super Admin dashboard:

Organizations

Example:

| Organization | Students | Teachers | Classes | Active |
| ------------ | -------: | -------: | ------: | ------ |
| School A     |      542 |       46 |      24 | Yes    |
| School B     |      380 |       31 |      18 | Yes    |

Actions:

* Create
* Edit
* Activate
* Deactivate
* Manage Admin
* Open Organization

Super Admin can manage organizations.

Organization Admin cannot manage organizations outside their own tenant.

---

# 66. ORGANIZATION DEACTIVATION

When an organization becomes inactive:

* users cannot normally log in
* data is retained
* historical reports remain stored
* Super Admin can reactivate it
* action is audited

Do not automatically delete organization data.

---

# 67. ADMIN DASHBOARD

Dashboard must display real calculated values.

Example:

## Organization Overview

Students
Teachers
Classes
Subjects

Reports this month
Lessons recorded
Reports submitted
Reports approved
Reports returned
Drafts

Attendance

Performance distribution

Homework

Participation

Conduct

Students requiring follow-up

---

# 68. NO FAKE "MISSED LESSON" STATISTICS

Because there is no timetable, the system must NOT say:

"Teacher failed to submit today's lesson"

unless an explicit Admin-configured reporting target exists.

Normal statistics:

* Reports created
* Reports submitted
* Reports approved
* Lessons recorded
* Students covered
* Classes reported
* Subjects reported

Optional future reporting targets may be configured.

---

# 69. DATA QUALITY DASHBOARD

Admin should see:

* Draft reports
* Returned reports
* Incomplete drafts
* Submitted reports with missing students
* Students with no monthly records
* Subjects with no records
* Duplicate attempts
* Invalid imports

Do not label something "missing lesson" unless a formal reporting requirement exists.

---

# 70. TEACHER DASHBOARD

Teacher homepage:

## Welcome, [Teacher Name]

Current Academic Year
Current Term

### My Classes

Each assignment appears as a card.

Example:

GRADE 7A

Subjects:

Mathematics
Physics

Actions:

`NEW REPORT`

`HISTORY`

`MONTHLY REPORT`

`STUDENTS`

---

# 71. TEACHER DASHBOARD STATISTICS

Show:

* drafts
* submitted
* approved
* returned
* reports created this month
* classes reported
* subjects reported
* recent activity

Do not display unrelated school-wide information.

---

# 72. TEACHER REPORT HISTORY

Filters:

* date
* month
* class
* subject
* status

Display:

* lesson date
* class
* subject
* topic
* status
* created date
* submitted date

Teacher can open permitted reports.

---

# 73. TEACHER MONTHLY REPORT ACCESS

Teacher may view/download only reports they are authorized to access.

Example:

Teacher John assigned 7A Mathematics.

He can view:

7A Mathematics monthly data.

He cannot view:

7A English

unless assigned.

He cannot view:

8B Mathematics

unless assigned.

Use server-side authorization for report access.

---

# 74. ADMIN REPORT ACCESS

Admin can view all reports within their organization.

Filters:

* grade
* class
* subject
* teacher
* student
* month
* academic year
* term

---

# 75. STUDENT PROFILE

Admin student profile:

Student:

David K.

Tabs:

* Overview
* Daily Records
* Monthly Reports
* Attendance
* Behaviour/Conduct
* Academic History

Timeline:

20 Sep — Mathematics — Good
21 Sep — Mathematics — Needs Improvement
22 Sep — Physics — Excellent

Show actual records.

Do not generate unsupported interpretations.

---

# 76. BEHAVIOUR OBSERVATIONS

Create optional:

## behaviour_observations

Fields:

* id
* organizationId
* studentId
* teacherId
* classId
* date
* category
* severity
* description
* actionTaken
* followUpRequired
* createdAt
* updatedAt

Categories:

* Behaviour
* Academic
* Homework
* Participation
* Punctuality
* Other

This is optional for significant issues.

Do not force a separate behaviour record every day.

---

# 77. AUDIT LOGGING

Create:

## audit_logs

Fields:

* id
* organizationId nullable
* userId
* action
* entityType
* entityId
* metadata JSON where safe
* createdAt

Log:

* login
* logout
* failed login
* account activation
* account deactivation
* student creation
* student modification
* teacher creation
* teacher modification
* assignment creation
* assignment modification
* lesson creation
* lesson modification
* lesson submission
* report approval
* report return
* report reopening
* report export
* data import
* configuration change
* organization creation
* organization modification
* role change

Never log:

* password
* passwordHash
* authentication secret
* session token
* sensitive authentication information

---

# 78. AUDIT REQUIREMENT FOR OLD-DATE OVERRIDE

If Admin creates or modifies a lesson older than the normal 14-day window:

audit:

* Admin
* date
* record
* original date
* new date
* reason
* timestamp

---

# 79. MONTH CLOSING

Provide:

`OPEN MONTH`

`CLOSE MONTH`

When closed:

* teachers cannot edit approved reports for that month
* Admin can view
* Admin can reopen
* reopening is audited

A closed month remains reproducible from its raw records.

---

# 80. REPORT CALCULATION VERSIONING

Because monthly results depend on thresholds, store enough information to determine which calculation configuration was used.

If practical, use:

`calculationRuleVersion`

for monthly aggregation.

Do not silently change old reports because an administrator changed future thresholds.

Historical reports must remain explainable.

---

# 81. STATISTICS

Statistics must be real and derived from database records.

## Organization

* student count
* teacher count
* class count
* subject count
* lessons recorded
* reports submitted
* approval rate
* attendance
* performance distribution
* participation distribution
* homework distribution
* conduct distribution
* students requiring follow-up

## Class

* student count
* lessons recorded
* attendance
* performance distribution
* participation
* homework
* conduct

## Subject

* lessons
* students reported
* performance distribution
* participation
* homework
* attendance
* topics

## Student

* performance by subject
* attendance
* homework
* participation
* conduct
* monthly trends
* Needs Improvement observations

---

# 82. STATISTICS MUST SHOW SAMPLE SIZE

Whenever displaying a percentage or aggregate result, provide the number of relevant observations where practical.

Example:

Performance:

Good: 61%

Based on:
152 observations

Do not display percentages with no indication of the underlying amount where that would be misleading.

---

# 83. NO RANKING OF STUDENTS

Do not create a "best student" or "worst student" ranking.

Show factual distributions and trends.

Examples:

* students in each performance category
* number needing improvement
* attendance percentages
* homework completion percentages

---

# 84. SEARCH

Search:

Students:

* student ID
* name

Teachers:

* teacher ID
* name
* email

Reports:

* student
* class
* teacher
* subject
* date

Use pagination.

---

# 85. PERFORMANCE OPTIMIZATION

The application must feel fast.

Use:

* D1 indexes
* server-side filtering
* pagination
* batch operations
* minimal client payloads
* efficient joins
* debounced search
* lazy loading
* selective columns
* cached reference data where safe
* optimized dashboard queries

Do not load the whole organization into the browser.

Do not load every student when opening the dashboard.

Do not load every report when opening the monthly page.

---

# 86. D1 INDEXES

Create indexes for:

* organizationId
* teacherId
* studentId
* classId
* subjectId
* academicYearId
* termId
* lessonDate
* status

Composite indexes:

`organizationId + classId + academicYearId`

`organizationId + teacherId + lessonDate`

`organizationId + studentId + lessonDate`

`organizationId + subjectId + lessonDate`

`dailyLessonId + studentId`

`organizationId + teacherId + classId + subjectId + lessonDate`

---

# 87. BATCH SAVE

Saving a class report must not perform one unnecessary browser request per student.

Use one server operation to process:

* lesson
* student records

Use D1-compatible batching/transactions.

Validate first.

Then write.

Avoid partial successful submissions.

---

# 88. TRANSACTIONAL DATA INTEGRITY

When submitting a class report:

1. Authenticate teacher.
2. Verify teacher assignment.
3. Verify date range.
4. Verify class ownership.
5. Verify subject ownership.
6. Load authoritative student roster.
7. Compare submitted student IDs against roster.
8. Reject unauthorized students.
9. Detect missing students.
10. Validate values.
11. Validate conditional comments.
12. Prevent duplicate lesson.
13. Create/update lesson.
14. Create/update student records.
15. Return success.

Do not allow a teacher to attach a student from another class.

---

# 89. IDOR DEFENSE

Every request involving:

* student ID
* lesson ID
* daily record ID
* class ID
* subject ID
* teacher ID

must perform server-side ownership/assignment checks.

Do not assume that because a user knows an ID they are allowed to access it.

---

# 90. IMPORT SECURITY

Excel imports are untrusted input.

Do not execute formulas or macros.

Treat imported values as data only.

Validate:

* file format
* file size
* columns
* row count
* values
* IDs
* organization context

Do not allow imported spreadsheet content to modify system configuration or roles.

---

# 91. API SECURITY

All API endpoints/server actions must:

* authenticate
* authorize
* validate
* verify tenant
* verify entity ownership
* return safe errors

No sensitive API endpoint may depend only on frontend route protection.

---

# 92. ROUTE PROTECTION

Suggested routes:

/login

/dashboard

/teacher

/teacher/classes

/teacher/reports

/teacher/reports/new

/teacher/reports/[id]

/teacher/reports/history

/teacher/monthly-reports

/teacher/students

/admin

/admin/students

/admin/teachers

/admin/classes

/admin/grades

/admin/subjects

/admin/assignments

/admin/daily-reports

/admin/monthly-reports

/admin/statistics

/admin/import

/admin/settings

/admin/audit

/super-admin

/super-admin/organizations

/super-admin/users

Every protected route must enforce server-side authorization.

---

# 93. TEACHER PAGE RULE

Teachers must never see links to administration pages.

But hiding navigation is NOT sufficient.

Unauthorized requests must also be rejected server-side.

---

# 94. ADMIN PAGE RULE

Organization Admins must never see another organization's records.

Even Super Admin organization selection should create an explicit organization context and all operations must remain auditable.

---

# 95. ERROR HANDLING

Implement:

* loading states
* validation errors
* database error handling
* duplicate errors
* permission errors
* expired session
* import errors
* export errors
* network errors
* empty states

Use clear messages.

Examples:

"Your session has expired. Please sign in again."

"You are not assigned to this class and subject."

"The selected lesson date must be within the last 14 days."

"A report already exists for this class, subject and date."

"Please record all active students before submitting."

---

# 96. MOBILE DESIGN

Teachers may report using:

* phone
* tablet
* laptop
* desktop

The daily class report must be optimized for mobile/tablet.

Use:

* touch-friendly controls
* compact student cards
* fast dropdowns
* large save/submit controls

Desktop may use a table/grid layout.

Mobile may use student cards.

Do not require a huge horizontally scrolling table on mobile.

---

# 97. UI DESIGN

Professional international-school administration system.

Use:

* clean modern visual hierarchy
* accessible typography
* consistent spacing
* status badges
* clear navigation
* responsive cards
* efficient data tables
* filters
* confirmation dialogs
* toast notifications
* skeleton loaders
* empty states

Do not overdecorate the reporting workflow.

Speed is more important than visual effects.

---

# 98. ACCESSIBILITY

Implement:

* semantic controls
* labels
* keyboard navigation
* visible focus
* proper input descriptions
* accessible tables
* accessible dropdowns
* clear validation
* adequate contrast

Do not communicate critical information only through color.

---

# 99. SCHOOL FORM REFERENCE

Use the uploaded school form as the source for the monthly report structure.

It contains:

## Student Information

* Student Name
* Grade/Class
* Teacher
* Month
* Academic Year

## Academic Performance

* Subject
* Topic(s) Covered
* Performance Level

Subjects currently represented:

* English
* Mathematics
* Science
* Computing
* Global Citizenship
* French
* Turkish
* Kirundi

Performance:

* Excellent
* Good
* Needs Improvement

## Discipline & School Conduct

* Class Conduct
* Punctuality
* Homework & Assignments
* Participation in Class

## Attendance

* Present
* Late coming
* Absent

The new version requires the digital system to use:

`Present`
`Late`
`Absent`

for daily attendance and monthly totals.

## The final digital report should preserve the school's terminology and intent rather than replacing it with unrelated grading categories.

# 100. FINAL MONTHLY REPORT DESIGN

## MONTHLY STUDENT ACADEMIC AND BEHAVIOURAL FOLLOW-UP

Month:
September 2026

Academic Year:
2026-2027

Student:
David K.

Grade/Class:
7A

Teacher(s):
calculated from authorized subject reports as appropriate

---

## 1. ACADEMIC PERFORMANCE

| Subject            | Topic(s) Covered   | Performance Level |
| ------------------ | ------------------ | ----------------- |
| English            | Grammar, Reading   | Good              |
| Mathematics        | Fractions, Algebra | Needs Improvement |
| Science            | Cells              | Good              |
| Computing          | Algorithms         | Excellent         |
| Global Citizenship | Citizenship        | Good              |
| French             | Grammar            | Good              |
| Turkish            | Reading            | Good              |
| Kirundi            | Writing            | Good              |

Use only subjects relevant to the student's academic context.

---

## 2. DISCIPLINE & SCHOOL CONDUCT

Class Conduct:
Good

Punctuality:
Occasionally Late

Homework & Assignments:
Usually Completed

Participation in Class:
Active

---

## 3. ATTENDANCE

Present:
19

Late:
2

Absent:
1

---

## 4. TEACHER / SCHOOL COMMENT

Display significant observations based on actual daily records.

---

## 5. REPORT INFORMATION

Generated date

Data period

Calculation version

Approval status

Reviewer

---

# 101. MONTHLY REPORT BY SUBJECT

A subject-specific report must not mix unrelated subjects.

Example:

Student:
David K.

Subject:
Mathematics

Month:
September 2026

Show only Mathematics records.

---

# 102. CLASS SUBJECT REPORT

Example:

Class:
7A

Subject:
Mathematics

Month:
September 2026

Show all students in 7A with Mathematics data.

---

# 103. ORGANIZATION MONTHLY REPORT

Admin can generate:

Organization
+
Month

with:

* class summaries
* subject summaries
* attendance statistics
* performance statistics
* participation
* homework
* conduct
* reporting activity

---

# 104. REPORT DOWNLOADS

Every report screen should have a clear download section.

Student:

* Download PDF
* Download Excel

Class:

* Download PDF
* Download Excel
* Download CSV

Statistics:

* Download Excel
* Download CSV

---

# 105. EXCEL REPORT OUTPUT

Generated Excel reports should use real Excel workbooks with:

* headers
* filters
* readable column widths
* date formatting
* percentages
* summary rows
* separate sheets where useful

Do not generate plain HTML pretending to be XLSX.

---

# 106. PDF OUTPUT

PDF/print layout must contain:

* school name
* report title
* period
* student/class information
* academic table
* conduct table
* attendance
* comments
* approval information

Use Unicode-safe text.

Support accents and French characters.

Do not use WinAnsi-only assumptions.

---

# 107. REPORT DATA COMPLETENESS

Every monthly report should indicate its source coverage.

Example:

Lessons/Reports Recorded:
18

Students Covered:
29/30

If data is incomplete, clearly indicate that.

Never manufacture a monthly result from missing records.

---

# 108. EMPTY DATA RULES

If no records exist:

show:

`No records available for this reporting period.`

Do not display:

Excellent
Good
Needs Improvement

unless data actually supports it.

If there are only partial records:

show the amount of data available.

---

# 109. TREND ANALYSIS

For a student, optionally display historical trends:

September
October
November

for:

* performance
* attendance
* homework
* participation
* conduct

Use actual historical values.

No unsupported predictions.

---

# 110. REPORT CALCULATION TRANSPARENCY

For every final category, retain the underlying counts.

Example:

Monthly Performance:
Good

Supporting observations:

Excellent: 3
Good: 14
Needs Improvement: 2

This makes the result auditable.

---

# 111. SYSTEM SETTINGS FOR MONTHLY RULES

Create a configuration system rather than hard-coding values.

Examples:

performanceExcellentScore = 3
performanceGoodScore = 2
performanceNeedsImprovementScore = 1

homeworkAlwaysThreshold = 1.0
homeworkUsuallyThreshold = 0.8

punctualityAlwaysLateRate = 0
punctualityOccasionallyMaxRate = 0.10

Admin can change rules for future calculations.

---

# 112. FUTURE-DATE POLICY

Default:

future lesson date = NOT ALLOWED

The server rejects:

lessonDate > today in organization timezone

Do not allow users to bypass this by changing timezone in browser.

---

# 113. OLDER-THAN-14-DAYS POLICY

Default:

teacher lessonDate older than 14 calendar days = NOT ALLOWED

Server checks:

`lessonDate >= today - 14 days`

Admin correction workflow can bypass only with explicit permission and audit log.

---

# 114. DATE EDGE CASES

Handle:

* month boundaries
* year boundaries
* leap years
* timezone changes
* daylight-saving rules if applicable
* academic-year boundaries

Do not use simplistic string comparisons when date arithmetic is required.

Use a reliable date library compatible with the runtime, or carefully implemented UTC/calendar logic.

---

# 115. ACADEMIC YEAR VALIDATION

A valid lesson date should belong to the selected academic year.

If:

lessonDate is outside the academic year

reject unless Admin performs an explicit historical correction.

---

# 116. TERM VALIDATION

If the lesson date falls within a term:

assign that term.

If academic configuration is inconsistent:

show an Admin-configurable validation state.

Do not blindly assign the wrong term.

---

# 117. CLASS ROSTER VALIDATION

When teacher selects class/date:

use the active roster associated with:

class + academic year

If class roster has changed, preserve historical records.

Do not retroactively change old lesson records merely because the student later moved class.

---

# 118. STUDENT STATUS

Student status:

ACTIVE
INACTIVE

Optional future statuses may be added.

Inactive students should not appear in normal new lesson rosters.

Historical records remain available.

---

# 119. TEACHER STATUS

Teacher status:

ACTIVE
INACTIVE

Inactive teachers cannot create new reports.

Historical reports remain accessible to authorized Admins.

---

# 120. SUBJECT STATUS

Subject:

ACTIVE
INACTIVE

Inactive subjects should not appear in new assignments/report creation.

Historical records remain valid.

---

# 121. CLASS STATUS

Class:

ACTIVE
INACTIVE

Inactive classes should not appear in new teacher dashboards.

Historical reports remain available.

---

# 122. SUPER ADMIN SECURITY

SUPER_ADMIN is the most privileged role.

Protect it strongly.

Do not create generic public Super Admin credentials.

Initialize securely.

Do not expose Super Admin UI to normal users.

All Super Admin actions must be audited.

---

# 123. ADMIN SECURITY

Admin creation must be performed by Super Admin.

Teacher must never elevate itself to Admin.

Teacher must never modify role fields directly.

Changing role requires privileged Admin/Super Admin action.

---

# 124. FIRST-RUN INITIALIZATION

If no Super Admin exists:

provide secure first-run configuration.

Credentials must be supplied securely via:

* environment variables
* secure initialization
* or one-time setup

Never hard-code production credentials.

After initialization, disable open setup.

---

# 125. ADMIN CREATION

Super Admin:

Create Organization
→ Create primary Admin
→ Admin receives/set secure credentials
→ Admin configures organization

Admin then manages teachers and students.

---

# 126. DATA IMPORT DUPLICATE RULES

Students:

unique by:

organization + studentId

Teachers:

unique by:

organization + teacherId

Teacher assignment:

unique by:

organization + teacher + class + subject + academicYear

Daily lesson:

unique by:

organization + teacher + class + subject + lessonDate

Student daily record:

unique by:

dailyLesson + student

---

# 127. DELETIONS

Avoid destructive hard deletion of academic records.

Prefer:

* deactivate
* archive

For sensitive deletions:

require confirmation.

For historical reports:

preserve references.

---

# 128. AUDITABLE ADMIN CORRECTIONS

When Admin changes:

* student
* teacher
* assignment
* daily report
* month
* calculation rule

store an audit entry.

For important modifications, preserve:

old value
new value
who changed it
when
reason if required

---

# 129. NO CLIENT-SIDE TRUST

Never trust:

* role
* teacher ID
* organization ID
* class ID
* student ID
* subject ID
* academic year ID
* date
* report status

Everything important must be revalidated server-side.

---

# 130. FRONTEND SECURITY

Do not put sensitive data into:

* public HTML
* client-side constants
* localStorage unnecessarily
* URLs where avoidable
* analytics payloads

Avoid localStorage for authentication tokens.

---

# 131. CONTENT SECURITY

Prevent stored XSS through teacher comments and imported text.

Escape/render user-provided content safely.

Do not use unsafe HTML rendering for comments.

---

# 132. DATABASE SECURITY

Use Drizzle/parameterized queries.

Do not construct raw SQL from user strings.

If raw SQL is necessary, parameterize it.

Do not return whole database rows if the client only needs a subset.

---

# 133. ERROR MESSAGE SECURITY

Do not expose:

* database errors
* SQL statements
* stack traces
* internal path names
* environment values

Log detailed errors server-side.

Show clean user-facing messages.

---

# 134. RATE LIMITING

Protect:

* login
* password reset
* high-cost report generation
* imports
* exports where appropriate

Prevent abuse without making normal school usage difficult.

---

# 135. REPORT GENERATION ABUSE PREVENTION

If report generation is expensive:

* validate authorization first
* limit excessive repeated requests
* cache safe repeated calculations where useful
* paginate large outputs
* prevent arbitrary cross-tenant queries

---

# 136. PERFORMANCE TARGET

Optimize the common teacher workflow.

Target:

Teacher opens dashboard
→ sees assignments quickly

Select class
→ class roster loads quickly

Select subject
→ report form loads quickly

Save class report
→ one efficient server operation

Do not build a slow multi-request workflow.

---

# 137. TEACHER EXPERIENCE PRIORITY

The most important user experience is:

LOGIN
→ MY CLASSES
→ NEW REPORT
→ CLASS
→ SUBJECT
→ DATE
→ TOPIC
→ STUDENTS
→ SET ALL NORMAL
→ CHANGE EXCEPTIONS
→ SAVE/SUBMIT

This should be possible with minimal clicks.

---

# 138. NO UNNECESSARY FIELDS

Do not ask teachers to manually enter:

* teacher name
* organization
* academic year if already known
* subject if determined by assignment
* student ID if loaded
* class name if selected

Automate those.

Teacher should enter only information that is genuinely required.

---

# 139. REPORT DATE UI

Use a date picker.

Show:

`Allowed range: [minimum] to [today]`

If current date is:

28 September 2026

show:

`You can record lessons from 14 September 2026 through 28 September 2026.`

This gives teachers a clear explanation.

---

# 140. REPORT STATUS UI

Use badges:

DRAFT
SUBMITTED
UNDER REVIEW
APPROVED
RETURNED

Use accessible text.

---

# 141. ADMIN REPORTING MONITOR

Admin can filter by:

* teacher
* class
* subject
* date
* month
* status

See:

* lesson date
* submitted date
* status
* teacher
* class
* subject

---

# 142. DATA QUALITY CHECK FOR SUBMISSION

Before final submission:

Show:

Students expected:
30

Students recorded:
30

Present:
27

Late:
2

Absent:
1

Needs Improvement:
3

Then:

`SUBMIT CLASS REPORT`

This gives the teacher confidence before submission.

---

# 143. CONFIRMATION BEFORE SUBMISSION

Show summary:

Date:
22 September 2026

Class:
7A

Subject:
Mathematics

Students:
30

Present:
27

Late:
2

Absent:
1

Then:

`Confirm Submission`

---

# 144. APPROVAL SUMMARY

Admin sees:

Teacher
Class
Subject
Lesson Date
Topic
Student count
Status
Submitted time

Admin actions:

`Review`

`Approve`

`Return`

---

# 145. RETURN WORKFLOW

When Admin returns:

Comment required.

Example:

`Please complete the attendance record for all students.`

Teacher sees:

RETURNED

Reason:
...

Action:

`EDIT AND RESUBMIT`

---

# 146. MONTHLY STATISTICS SCREEN

Admin filters:

Academic Year
Term
Month

Then:

Grade
Class
Subject
Teacher

Cards:

Students
Lessons
Attendance %
Performance
Homework
Participation
Conduct

Charts:

* performance distribution
* attendance distribution
* homework distribution
* participation distribution
* conduct distribution
* report activity

---

# 147. NO MISLEADING STATISTICS

If only 4 lessons have been recorded:

do not imply this represents the whole month.

Show:

`4 lesson reports recorded`

and where appropriate:

`Statistics based on 4 recorded lessons.`

---

# 148. EXPORT SECURITY

Before exporting:

* authorize user
* apply organization filter
* apply teacher assignment filter
* validate requested period
* generate only permitted data

A teacher cannot export another class simply by changing a class ID.

---

# 149. API RESPONSE MINIMIZATION

Return only fields needed by the client.

Do not return:

* passwordHash
* internal authentication fields
* unrestricted organization data
* unrelated students

---

# 150. LOCAL DEVELOPMENT

Provide:

`.env.example`

Document:

* database binding
* auth secret
* organization timezone configuration
* local development commands
* D1 commands
* migrations
* seed

Do not put real secrets in the repository.

---

# 151. DATABASE MIGRATIONS

Provide proper migrations.

Include:

* initial schema
* indexes
* constraints
* seed data

Migrations must be repeatable and documented.

---

# 152. SEED DATA

Create realistic development seed data.

Organization:

Demo International School

Academic Year:

2026-2027

Terms:

Term 1
Term 2
Term 3

Grades:

Grade 1 through Grade 13

Classes:

7A
7B
8A
8B
9A
10B
11A

Subjects:

English
Mathematics
Science
Computing
Global Citizenship
French
Turkish
Kirundi
Physics

Teachers:

At least five.

Use mixed assignments.

Students:

At least 100 realistic demo students.

Create multiple daily reports across multiple dates.

Create enough records to demonstrate:

* monthly statistics
* student reports
* class reports
* subject reports
* attendance
* performance
* homework
* participation
* conduct

---

# 153. DEMO ASSIGNMENT TEST

At minimum create:

John:

7A Mathematics
8A Mathematics
10B Physics
11A Physics

Sarah:

7A English
8B English
9A Global Citizenship

This must prove the application supports mixed subject/class assignments.

---

# 154. TEST DATE RULE

Use today = 28 September 2026 in a unit test.

Allowed:

14 September 2026
15 September 2026
...
28 September 2026

Rejected:

13 September 2026

Rejected:

29 September 2026

Also test the same logic around:

* 1st of month
* year boundary
* leap year

---

# 155. TEST TEACHER ASSIGNMENT SECURITY

Test:

John assigned:

7A Mathematics

John attempts:

7A English

Must be rejected.

John attempts:

8B Mathematics

Must be rejected if not assigned.

John attempts:

Organization B, 7A Mathematics

Must be rejected.

---

# 156. TEST STUDENT CLASS SECURITY

John assigned 7A Mathematics.

Student A belongs to 7A.

Student B belongs to 7B.

John submits student B in his 7A report.

Must be rejected.

---

# 157. TEST DUPLICATE REPORT

Create:

John
7A
Mathematics
22 September

Then attempt second identical report.

Must reject with duplicate condition.

---

# 158. TEST BACKDATED ENTRY

Today:

28 September

Teacher enters:

20 September

Must be accepted if valid assignment and academic-year conditions are satisfied.

---

# 159. TEST FUTURE ENTRY

Today:

28 September

Teacher enters:

29 September

Must be rejected.

---

# 160. TEST OLD ENTRY

Today:

28 September

Teacher enters:

13 September

Must be rejected for TEACHER.

Admin override may be tested separately.

---

# 161. TEST ABSENT LOGIC

Set student:

Attendance = ABSENT

Ensure:

* academic fields disabled
* no false academic result
* attendance count increases
* monthly academic aggregation excludes that lesson's performance

---

# 162. TEST LATE LOGIC

Set:

Attendance = LATE

Ensure:

* academic fields available
* participation available
* homework available
* conduct available
* monthly Present/Late/Absent statistics correctly count Late
* punctuality considers Late

---

# 163. TEST MONTHLY AGGREGATION

Create daily data:

Excellent = 2
Good = 11
Needs Improvement = 5

Verify:

* counts are correct
* monthly result is generated
* supporting counts are visible
* month is determined by lessonDate

---

# 164. TEST DELAYED ENTRY

Create lesson:

lessonDate = 20 September

createdAt = 26 September

Verify monthly report places it in September.

---

# 165. TEST ORGANIZATION ISOLATION

Create:

Organization A
Organization B

Same-looking students/classes in both organizations.

Attempt cross-tenant access.

Every cross-tenant query must fail.

Test:

* student profile
* reports
* assignments
* statistics
* exports
* dashboard counts

---

# 166. TEST ROLE ESCALATION

Teacher attempts:

POST role=ADMIN

Must fail.

Teacher attempts:

organizationId = another organization

Must fail.

Admin attempts:

role=SUPER_ADMIN

Must fail.

---

# 167. TEST DIRECT URL ACCESS

Teacher tries:

`/admin/students`

Must return unauthorized/forbidden.

Teacher tries another teacher's report ID:

must fail unless authorized.

---

# 168. TEST API MANIPULATION

Manually alter:

studentId
classId
subjectId
teacherId
organizationId

Server must reject unauthorized combinations.

---

# 169. QA REQUIREMENT

Do not declare the app complete because the UI renders.

Verify:

* actual authentication
* actual D1 queries
* actual assignment checks
* actual report creation
* actual aggregation
* actual downloads
* actual role restrictions
* actual tenant isolation
* actual date validation

---

# 170. CODE QUALITY

Use:

* strict TypeScript
* reusable components
* typed database access
* modular feature architecture
* centralized permissions
* centralized validation
* server-side business logic
* clean error handling
* unit tests
* integration tests where practical

Do not use:

`any`

without strong justification.

---

# 171. RECOMMENDED PROJECT STRUCTURE

Use a clean structure such as:

app/
(auth)/
dashboard/
teacher/
admin/
super-admin/
reports/

components/

features/
auth/
organizations/
students/
teachers/
grades/
classes/
subjects/
assignments/
lessons/
attendance/
reporting/
statistics/
imports/

db/
schema/
migrations/
queries/

lib/
auth/
permissions/
validation/
dates/
reporting/
statistics/

Do not put everything into one component.

---

# 172. BUSINESS LOGIC MUST NOT LIVE ONLY IN COMPONENTS

Core rules such as:

* 14-day date window
* assignment validation
* tenant isolation
* monthly aggregation
* duplicate prevention
* report approval

must live in reusable server-side services/functions.

The UI may provide client-side assistance, but business rules must have a server-side authoritative implementation.

---

# 173. DATE SERVICE

Create a centralized date utility/module responsible for:

* current school date
* minimum allowed lesson date
* maximum allowed lesson date
* date validation
* academic year validation
* term lookup
* monthly grouping

Do not duplicate date rules across multiple components.

---

# 174. PERMISSION SERVICE

Create reusable server-side permission functions such as conceptually:

`requireAuthenticatedUser()`

`requireSuperAdmin()`

`requireOrganizationAdmin()`

`requireTeacher()`

`requireTeacherAssignment()`

`requireStudentAccess()`

`requireLessonAccess()`

Do not repeat insecure authorization logic manually across pages.

---

# 175. REPORTING SERVICE

Create a reporting service responsible for:

* monthly aggregation
* topic aggregation
* performance calculation
* participation calculation
* homework calculation
* punctuality calculation
* attendance calculation
* conduct calculation
* report datasets

This makes reports consistent across PDF, Excel, UI and dashboard.

---

# 176. STATISTICS SERVICE

Create optimized query/service functions for:

* organization statistics
* class statistics
* subject statistics
* student statistics
* monthly trends

Do not calculate large statistics only in the browser.

Use D1 queries and server-side aggregation.

---

# 177. CACHING

Cache only safe reference information where appropriate:

* active subjects
* grades
* academic years
* terms

Do not cache sensitive user-specific information in a way that can leak across tenants.

Tenant-specific cached data must include organization identity in the cache key.

---

# 178. OBSERVABILITY

Implement safe server-side logging.

Log:

* unexpected server errors
* authentication failures at an appropriate level
* important security events

Never log:

* passwords
* password hashes
* session tokens
* secrets
* full sensitive student records unnecessarily

---

# 179. DEPLOYMENT

Provide:

`README.md`

including:

## Local Setup

* install
* configure environment
* initialize database
* migrate
* seed
* run

## Cloudflare Setup

* create Workers project
* create D1 database
* configure binding
* configure secrets
* apply migrations
* deploy

Do not assume a local persistent SQLite file will magically work on Workers.

---

# 180. ENVIRONMENT VARIABLES

Provide:

`.env.example`

with placeholders such as:

AUTH_SECRET=
APP_URL=
SUPER_ADMIN_INITIAL_EMAIL=
SUPER_ADMIN_INITIAL_USERNAME=

Do not commit secrets.

Use Cloudflare secrets/bindings appropriately in production.

---

# 181. CLOUDFLARE CONFIGURATION

Provide the appropriate configuration file(s) for the selected current Cloudflare deployment method.

Ensure:

* D1 binding name is consistent
* build command is correct
* deploy command is correct
* migrations are documented
* environment variables are documented

Do not generate configuration that only works in local development.

---

# 182. FUTURE MIGRATION FLEXIBILITY

Keep architecture sufficiently modular that the database layer can later be migrated if needed.

But for this release:

PRODUCTION = D1

Do not prematurely introduce multiple databases.

---

# 183. NO EXTERNAL AI DEPENDENCY

Core application must not require OpenAI, Gemini, Anthropic, or another external AI service.

Monthly calculations must be deterministic.

AI can be added later as an optional feature.

Do not use AI to invent student observations.

---

# 184. OPTIONAL FUTURE AI

Future optional AI might:

* summarize existing teacher comments
* summarize monthly observations

If implemented later:

* use only stored data
* label output as AI-generated draft
* require human review
* never fabricate facts

Do not build this into the mandatory core.

---

# 185. NO FILE/EVIDENCE MODULE

Again, explicitly:

Do NOT implement file uploads.

Do NOT implement R2.

Do NOT implement proof/evidence.

Do NOT implement attachment management.

The current release must remain structured-data-only.

---

# 186. FINAL TEACHER WORKFLOW

The final teacher workflow must be:

LOGIN

↓

DASHBOARD

↓

MY CLASSES

↓

SELECT CLASS

↓

SELECT SUBJECT

↓

SELECT LESSON DATE

↓

ENTER TOPIC

↓

SYSTEM LOADS ACTIVE CLASS STUDENTS

↓

SET ALL NORMAL

↓

CHANGE EXCEPTIONS

↓

SAVE DRAFT or SUBMIT

↓

REPORT STORED

The teacher can repeat this as much as necessary within the allowed date policy.

No timetable restriction.

---

# 187. FINAL DAILY RECORD EXAMPLE

Example:

Teacher:
John Smith

Date:
22 September 2026

Class:
7A

Subject:
Mathematics

Topic:
Fractions

Students:

Aline:
Present
Good
Active
Completed
Good

David:
Present
Needs Improvement
Passive
Not Completed
Good
Comment:
Difficulty understanding fractions

Eric:
Absent

The system creates one:

`daily_lessons`

record

and three:

`daily_student_records`

records.

The teacher sees this as one form.

---

# 188. FINAL MONTHLY EXAMPLE

At the end of September:

David

Mathematics

Lessons:
18

Present:
16

Late:
2

Absent:
1

Performance:

Excellent:
2

Good:
11

Needs Improvement:
5

Participation:

Active:
7

Moderate:
6

Passive:
5

Homework:

Completed:
12

Not Completed:
6

Conduct:
Good

Punctuality:
Occasionally Late

Topics:
Fractions
Equivalent Fractions
Algebra

The system generates the subject monthly report.

---

# 189. FINAL ACCEPTANCE SCENARIO

The implementation is only complete if all of the following works:

1. Super Admin logs in.
2. Super Admin creates Organization A.
3. Super Admin creates its Admin.
4. Admin logs in.
5. Admin configures Academic Year 2026-2027.
6. Admin configures terms.
7. Admin configures grades.
8. Admin configures classes.
9. Admin configures subjects.
10. Admin imports students.
11. Admin imports teachers.
12. Admin creates teacher assignments.
13. John receives:

    * 7A Mathematics
    * 8A Mathematics
    * 10B Physics
    * 11A Physics
14. John logs in.
15. John sees only those assignments.
16. John selects 7A.
17. System shows Mathematics and any other assigned subjects for 7A.
18. John selects Mathematics.
19. John selects 22 September 2026.
20. System accepts the date if within the 14-day window.
21. System rejects older dates.
22. System rejects future dates.
23. John enters Fractions.
24. System loads only active 7A students.
25. John clicks Set All Normal.
26. John changes David to Needs Improvement.
27. John adds a comment.
28. John marks Eric Absent.
29. John saves draft.
30. John later reopens.
31. John submits.
32. System validates the complete roster.
33. System writes lesson + student records atomically/consistently.
34. Admin sees the submission.
35. Admin approves.
36. John cannot modify approved data.
37. Admin can reopen with reason.
38. Audit log records reopening.
39. John can enter another valid report later for an earlier date within 14 days.
40. John can enter multiple reports on the same current day for different assigned classes/subjects.
41. No timetable blocks him.
42. John cannot access unrelated classes.
43. John cannot access unrelated subjects.
44. John cannot access another organization.
45. Teacher cannot manipulate organizationId to bypass security.
46. Teacher cannot submit another class's student.
47. Teacher cannot escalate role.
48. Monthly statistics aggregate from lessonDate.
49. Attendance counts Present/Late/Absent correctly.
50. Punctuality is derived from Late records.
51. Performance is aggregated correctly.
52. Participation is aggregated correctly.
53. Homework is aggregated correctly.
54. Conduct is aggregated correctly.
55. Topics are deduplicated.
56. Student monthly subject report works.
57. Full student monthly report works.
58. Class monthly subject report works.
59. Full class monthly report works.
60. PDF/print output works.
61. Excel output works.
62. Statistics dashboard works.
63. Organization isolation works.
64. Super Admin organization management works.
65. Import system works.
66. Audit logging works.
67. Month closing works.
68. Cloudflare D1 deployment works.
69. No local production SQLite file is required.
70. No R2/file-upload dependency exists.
71. No mandatory external AI dependency exists.

---

# 190. FINAL ENGINEERING STANDARD

Do not stop at:

"UI complete"

"database connected"

or:

"basic CRUD implemented"

The product is complete only when:

* authentication works
* authorization works
* tenant isolation works
* assignment restrictions work
* date validation works
* daily class reporting works
* batch student recording works
* drafts work
* review workflow works
* monthly aggregation works
* statistics work
* student reports work
* class reports work
* downloads work
* imports work
* audit logs work
* Cloudflare deployment works
* automated tests cover critical security/business rules

---

# 191. FINAL PRODUCT PRINCIPLE

The application must make teacher reporting **easier than the paper form**, not harder.

The teacher should think:

"Which class?"
"Which subject?"
"What date was the lesson?"
"What topic?"
"What happened with each student?"

Everything else should be automated.

The monthly report is generated automatically.

The system must not ask teachers to reconstruct an entire month from memory.

The system must preserve the school's reporting terminology and structure while modernizing the data collection process.

Build this as a serious school information system with security, performance, auditability, and maintainability as first-class requirements.
