CREATE TABLE `agent_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`goal` varchar(500) NOT NULL,
	`max_questions` tinyint NOT NULL,
	`messages` json NOT NULL,
	`state` json NOT NULL,
	`status` enum('active','finished') NOT NULL DEFAULT 'active',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `agent_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `review_logs` MODIFY COLUMN `source` enum('review','page','interview','mock','agent') NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD CONSTRAINT `agent_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `agent_sessions_user_created_idx` ON `agent_sessions` (`user_id`,`created_at`);