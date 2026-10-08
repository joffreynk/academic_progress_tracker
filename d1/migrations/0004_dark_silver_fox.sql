CREATE TABLE `monthly_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`class_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`academic_year_id` text,
	`teacher_id` text NOT NULL,
	`month` text NOT NULL,
	`sessions_held` integer DEFAULT 20 NOT NULL,
	`topics` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`class_name_snapshot` text,
	`subject_name_snapshot` text,
	`teacher_name_snapshot` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_at` integer,
	`reviewed_at` integer,
	`reviewed_by` text,
	`review_comment` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_entry_unique` ON `monthly_entries` (`organization_id`,`class_id`,`subject_id`,`month`);--> statement-breakpoint
CREATE INDEX `monthly_entry_status_idx` ON `monthly_entries` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `monthly_entry_class_month_idx` ON `monthly_entries` (`class_id`,`month`);--> statement-breakpoint
CREATE TABLE `monthly_student_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`monthly_entry_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_name_snapshot` text,
	`student_code_snapshot` text,
	`punctuality` text,
	`performance` text,
	`participation` text,
	`homework` text,
	`conduct` text,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`monthly_entry_id`) REFERENCES `monthly_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_student_unique` ON `monthly_student_entries` (`monthly_entry_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `monthly_student_org_idx` ON `monthly_student_entries` (`organization_id`,`student_id`);--> statement-breakpoint
ALTER TABLE `settings` ADD `reporting_cadence` text DEFAULT 'MONTHLY' NOT NULL;