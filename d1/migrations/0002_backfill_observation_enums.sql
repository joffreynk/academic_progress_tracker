-- Custom SQL migration file, put your code below! --
-- Backfill the new three-level homework scale and the separate punctuality rating.
-- Statements are idempotent so re-running is safe.
UPDATE `daily_student_records` SET `homework` = 'ALWAYS_COMPLETED' WHERE `homework` = 'COMPLETED';
--> statement-breakpoint
UPDATE `daily_student_records` SET `homework` = 'RARELY_COMPLETED' WHERE `homework` = 'NOT_COMPLETED';
--> statement-breakpoint
UPDATE `daily_student_records` SET `homework` = 'USUALLY_COMPLETED' WHERE `homework` = 'NOT_APPLICABLE';
--> statement-breakpoint
-- Derive punctuality from the recorded attendance for historical rows.
-- Absent students carry no punctuality rating, matching the daily report rules.
UPDATE `daily_student_records` SET `punctuality` = 'ALWAYS_ON_TIME' WHERE `attendance_status` = 'PRESENT' AND `punctuality` IS NULL;
--> statement-breakpoint
UPDATE `daily_student_records` SET `punctuality` = 'OCCASIONALLY_LATE' WHERE `attendance_status` = 'LATE' AND `punctuality` IS NULL;
