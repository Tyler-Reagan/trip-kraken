ALTER TABLE `Trip` DROP COLUMN `allowedModes`;--> statement-breakpoint
ALTER TABLE `Trip` ADD `allowedPathKinds` text;
