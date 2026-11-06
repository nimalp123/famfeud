CREATE TABLE `rate_limits` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`hits` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
