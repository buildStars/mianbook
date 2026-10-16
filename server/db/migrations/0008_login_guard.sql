CREATE TABLE `failed_logins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(191) NOT NULL,
	`ip` varchar(45),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `failed_logins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `failed_logins_email_idx` ON `failed_logins` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `failed_logins_ip_idx` ON `failed_logins` (`ip`,`created_at`);