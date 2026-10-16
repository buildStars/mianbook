CREATE TABLE `question_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`question_id` int NOT NULL,
	`ord` int NOT NULL,
	`heading` varchar(255) NOT NULL,
	`text` text NOT NULL,
	`hash` varchar(64) NOT NULL,
	`embedding` blob,
	`embed_model` varchar(128),
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `question_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `question_chunks_question_ord_unique` UNIQUE(`question_id`,`ord`)
);
--> statement-breakpoint
ALTER TABLE `question_chunks` ADD CONSTRAINT `question_chunks_question_id_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE cascade ON UPDATE no action;