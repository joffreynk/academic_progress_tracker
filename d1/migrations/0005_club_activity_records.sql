CREATE TABLE `club_activity_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`club_activity_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_name_snapshot` text,
	`student_code_snapshot` text,
	`punctuality` text,
	`performance` text,
	`participation` text,
	`conduct` text,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`club_activity_id`) REFERENCES `club_activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_activity_records_unique` ON `club_activity_records` (`club_activity_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `club_activity_records_student_idx` ON `club_activity_records` (`organization_id`,`student_id`);