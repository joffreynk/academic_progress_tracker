CREATE TABLE "academic_years" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"class_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "behaviour_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"student_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"class_id" text NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"action_taken" text,
	"follow_up_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"grade_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"class_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"term_id" text,
	"class_name_snapshot" text,
	"subject_name_snapshot" text,
	"teacher_name_snapshot" text,
	"academic_year_name_snapshot" text,
	"lesson_date" date NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_comment" text
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "month_closures" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"month" text NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_rule_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"month" text NOT NULL,
	"version" integer NOT NULL,
	"excellent_threshold" real NOT NULL,
	"good_threshold" real NOT NULL,
	"homework_usually_threshold" real NOT NULL,
	"punctuality_occasionally_max" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"domain" text,
	"logo_url" text,
	"timezone" text DEFAULT 'Africa/Bujumbura' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"primary_admin_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "daily_student_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"daily_lesson_id" text NOT NULL,
	"student_id" text NOT NULL,
	"student_name_snapshot" text,
	"student_code_snapshot" text,
	"attendance_status" text NOT NULL,
	"performance" text,
	"participation" text,
	"homework" text,
	"conduct" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"excellent_threshold" real DEFAULT 2.65 NOT NULL,
	"good_threshold" real DEFAULT 1.65 NOT NULL,
	"homework_usually_threshold" real DEFAULT 0.8 NOT NULL,
	"punctuality_occasionally_max" real DEFAULT 0.1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"student_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"full_name" text NOT NULL,
	"grade_id" text NOT NULL,
	"class_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"department" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teachers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"academic_year_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "years_org_name" ON "academic_years" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_unique" ON "teacher_assignments" USING btree ("organization_id","teacher_id","class_id","subject_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "assignment_teacher_idx" ON "teacher_assignments" USING btree ("organization_id","teacher_id");--> statement-breakpoint
CREATE INDEX "audit_org_date_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_org_year_name" ON "classes" USING btree ("organization_id","academic_year_id","name");--> statement-breakpoint
CREATE INDEX "classes_grade_idx" ON "classes" USING btree ("organization_id","grade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_org_name" ON "grades" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_unique" ON "daily_lessons" USING btree ("organization_id","teacher_id","class_id","subject_id","lesson_date");--> statement-breakpoint
CREATE INDEX "lessons_teacher_date_idx" ON "daily_lessons" USING btree ("organization_id","teacher_id","lesson_date");--> statement-breakpoint
CREATE INDEX "lessons_class_date_idx" ON "daily_lessons" USING btree ("organization_id","class_id","lesson_date");--> statement-breakpoint
CREATE INDEX "lessons_subject_date_idx" ON "daily_lessons" USING btree ("organization_id","subject_id","lesson_date");--> statement-breakpoint
CREATE INDEX "lessons_status_idx" ON "daily_lessons" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "closure_org_month" ON "month_closures" USING btree ("organization_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_snapshot_month_idx" ON "monthly_rule_snapshots" USING btree ("organization_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "record_lesson_student" ON "daily_student_records" USING btree ("daily_lesson_id","student_id");--> statement-breakpoint
CREATE INDEX "records_student_idx" ON "daily_student_records" USING btree ("organization_id","student_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_org_code" ON "students" USING btree ("organization_id","student_id");--> statement-breakpoint
CREATE INDEX "students_roster_idx" ON "students" USING btree ("organization_id","class_id","academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_org_code" ON "subjects" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_org_code" ON "teachers" USING btree ("organization_id","teacher_id");--> statement-breakpoint
CREATE INDEX "terms_year_idx" ON "terms" USING btree ("organization_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");