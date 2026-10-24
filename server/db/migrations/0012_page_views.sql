CREATE TABLE `page_views` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitor_id` varchar(32) NOT NULL,
	`user_id` int,
	`path` varchar(255) NOT NULL,
	`entry` boolean NOT NULL DEFAULT false,
	`referrer_host` varchar(128),
	`utm_source` varchar(64),
	`device` enum('mobile','desktop') NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `page_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `page_views` ADD CONSTRAINT `page_views_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `page_views_created_idx` ON `page_views` (`created_at`);--> statement-breakpoint
CREATE INDEX `page_views_visitor_idx` ON `page_views` (`visitor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `page_views_user_idx` ON `page_views` (`user_id`,`created_at`);