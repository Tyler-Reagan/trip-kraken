ALTER TABLE `Trip` DROP COLUMN `allowedPathKinds`;--> statement-breakpoint
ALTER TABLE `Trip` ADD `roadProfile` text DEFAULT 'walking' NOT NULL;
