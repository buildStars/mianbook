CREATE TABLE `error_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message` varchar(500) NOT NULL,
	`stack` text,
	`method` varchar(8),
	`path` varchar(255),
	`status_code` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `error_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `model` varchar(128);--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `prompt_version` varchar(32);--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `ttft_ms` int;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `latency_ms` int;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `status` enum('ok','aborted','error') DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `error` varchar(255);--> statement-breakpoint
CREATE INDEX `error_logs_created_idx` ON `error_logs` (`created_at`);