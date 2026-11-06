CREATE TABLE `question_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`prompt` text NOT NULL,
	`answers` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_bank_prompt_unique` ON `question_bank` (`prompt`);--> statement-breakpoint
CREATE INDEX `question_bank_category_idx` ON `question_bank` (`category`);