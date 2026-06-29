CREATE TABLE `Location` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`kind` text DEFAULT 'activity' NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`lat` real,
	`lng` real,
	`placeId` text,
	`excluded` integer DEFAULT false NOT NULL,
	`note` text,
	`rating` real,
	`reviewCount` integer,
	`categories` text,
	`visitDuration` integer,
	`openTime` text,
	`closeTime` text,
	`hoursJson` text,
	`phone` text,
	`checkInDate` text,
	`checkOutDate` text,
	`enrichmentStatus` text DEFAULT 'done' NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Placement` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`locationId` text NOT NULL,
	`date` text NOT NULL,
	`order` integer NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Trip` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sourceUrl` text,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`dayLabels` text,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL,
	`updatedAt` text DEFAULT (datetime('now')) NOT NULL
);
