CREATE TABLE `question_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`question_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`difficulty` tinyint NOT NULL,
	`tags` json NOT NULL,
	`status` enum('draft','published') NOT NULL,
	`content_md` mediumtext NOT NULL,
	`editor_id` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `question_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `question_versions` ADD CONSTRAINT `question_versions_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `question_versions` ADD CONSTRAINT `question_versions_editor_id_users_id_fk` FOREIGN KEY (`editor_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `question_versions_question_idx` ON `question_versions` (`question_id`,`created_at`);