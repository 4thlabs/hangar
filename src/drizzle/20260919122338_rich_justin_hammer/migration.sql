CREATE TABLE `notification` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`href` text,
	`dedupe_key` text,
	`seen_at` integer,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_notification_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `notification_userId_createdAt_idx` ON `notification` (`user_id`,`created_at`);