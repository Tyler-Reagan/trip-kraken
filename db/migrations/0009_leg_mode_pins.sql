CREATE TABLE `LegModePin` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`locationAId` text NOT NULL,
	`locationBId` text NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locationAId`) REFERENCES `Location`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locationBId`) REFERENCES `Location`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leg_mode_pin_unique` ON `LegModePin` (`tripId`,`locationAId`,`locationBId`);