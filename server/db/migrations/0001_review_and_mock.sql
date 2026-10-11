CREATE TABLE `mock_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(128) NOT NULL,
	`config` json NOT NULL,
	`items` json NOT NULL,
	`current_index` tinyint NOT NULL DEFAULT 0,
	`status` enum('active','finished') NOT NULL DEFAULT 'active',
	`score` double,
	`report` mediumtext,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`finished_at` datetime,
	CONSTRAINT `mock_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_cards` (
	`user_id` int NOT NULL,
	`question_id` int NOT NULL,
	`due` datetime NOT NULL,
	`stability` double NOT NULL,
	`difficulty` double NOT NULL,
	`elapsed_days` int NOT NULL DEFAULT 0,
	`scheduled_days` int NOT NULL DEFAULT 0,
	`learning_steps` int NOT NULL DEFAULT 0,
	`reps` int NOT NULL DEFAULT 0,
	`lapses` int NOT NULL DEFAULT 0,
	`state` tinyint NOT NULL DEFAULT 0,
	`last_review` datetime,
	CONSTRAINT `review_cards_user_id_question_id_pk` PRIMARY KEY(`user_id`,`question_id`)
);
--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`question_id` int NOT NULL,
	`rating` tinyint NOT NULL,
	`source` enum('review','page','interview','mock') NOT NULL,
	`prev_card` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `review_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `interviews` ADD `session_id` int;--> statement-breakpoint
ALTER TABLE `mock_sessions` ADD CONSTRAINT `mock_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_cards` ADD CONSTRAINT `review_cards_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_cards` ADD CONSTRAINT `review_cards_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_logs` ADD CONSTRAINT `review_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_logs` ADD CONSTRAINT `review_logs_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `mock_sessions_user_created_idx` ON `mock_sessions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_cards_user_due_idx` ON `review_cards` (`user_id`,`due`);--> statement-breakpoint
CREATE INDEX `review_logs_user_created_idx` ON `review_logs` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `interviews` ADD CONSTRAINT `interviews_session_id_mock_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `mock_sessions`(`id`) ON DELETE set null ON UPDATE no action;