CREATE TABLE `email_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(191) NOT NULL,
	`purpose` varchar(16) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`ip` varchar(45),
	`attempts` tinyint NOT NULL DEFAULT 0,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` datetime;--> statement-breakpoint
CREATE INDEX `email_codes_email_idx` ON `email_codes` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_codes_ip_idx` ON `email_codes` (`ip`,`created_at`);