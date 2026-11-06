CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`phase` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_public_lobby_idx` ON `rooms` (`is_public`,`phase`,`updated_at`);