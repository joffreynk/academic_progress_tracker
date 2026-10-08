CREATE TABLE `subject_students` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`class_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`student_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subject_students_unique` ON `subject_students` (`class_id`,`subject_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `subject_students_lookup_idx` ON `subject_students` (`organization_id`,`class_id`,`subject_id`);
