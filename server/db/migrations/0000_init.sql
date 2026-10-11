CREATE TABLE `ai_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`kind` varchar(32) NOT NULL,
	`prompt_tokens` int,
	`completion_tokens` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ai_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`part_id` int NOT NULL,
	`slug` varchar(64) NOT NULL,
	`title` varchar(64) NOT NULL,
	`sort` int NOT NULL DEFAULT 0,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_part_slug_unique` UNIQUE(`part_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`question_id` int NOT NULL,
	`turns` json NOT NULL,
	`rounds` tinyint NOT NULL DEFAULT 0,
	`score` tinyint,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `interviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `parts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`title` varchar(64) NOT NULL,
	`sort` int NOT NULL DEFAULT 0,
	CONSTRAINT `parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `parts_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` int NOT NULL,
	`slug` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`difficulty` tinyint NOT NULL DEFAULT 2,
	`tags` json NOT NULL,
	`content_md` mediumtext NOT NULL,
	`content_html` mediumtext NOT NULL,
	`content_text` mediumtext NOT NULL,
	`toc` json NOT NULL,
	`sort` int NOT NULL DEFAULT 0,
	`status` enum('draft','published') NOT NULL DEFAULT 'published',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `questions_id` PRIMARY KEY(`id`),
	CONSTRAINT `questions_category_slug_unique` UNIQUE(`category_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `study_records` (
	`user_id` int NOT NULL,
	`question_id` int NOT NULL,
	`status` enum('weak','fuzzy','mastered'),
	`starred` boolean NOT NULL DEFAULT false,
	`note` text,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `study_records_user_id_question_id_pk` PRIMARY KEY(`user_id`,`question_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(191) NOT NULL,
	`name` varchar(64) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin','user') NOT NULL DEFAULT 'user',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `ai_calls` ADD CONSTRAINT `ai_calls_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_part_id_parts_id_fk` FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `interviews` ADD CONSTRAINT `interviews_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `interviews` ADD CONSTRAINT `interviews_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `questions` ADD CONSTRAINT `questions_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `study_records` ADD CONSTRAINT `study_records_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `study_records` ADD CONSTRAINT `study_records_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_calls_user_created_idx` ON `ai_calls` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `interviews_user_question_idx` ON `interviews` (`user_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `questions_category_sort_idx` ON `questions` (`category_id`,`sort`);