CREATE TABLE `question_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`question_id` int NOT NULL,
	`user_id` int,
	`kind` enum('error','unclear','outdated','other') NOT NULL,
	`content` varchar(1000) NOT NULL,
	`ip_hash` varchar(64),
	`status` enum('open','resolved','ignored') NOT NULL DEFAULT 'open',
	`handled_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `question_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `question_feedback` ADD CONSTRAINT `question_feedback_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `question_feedback` ADD CONSTRAINT `question_feedback_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `question_feedback_status_idx` ON `question_feedback` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `question_feedback_ip_idx` ON `question_feedback` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `question_feedback_question_idx` ON `question_feedback` (`question_id`);