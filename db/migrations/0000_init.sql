CREATE TABLE `ItineraryDay` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`dayNumber` integer NOT NULL,
	`date` text,
	`label` text,
	FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ItineraryStop` (
	`id` text PRIMARY KEY NOT NULL,
	`dayId` text NOT NULL,
	`locationId` text NOT NULL,
	`ord` integer NOT NULL,
	`notes` text,
	`locked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`dayId`) REFERENCES `ItineraryDay`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Location` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
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
	`enrichmentStatus` text DEFAULT 'done' NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Stay` (
	`id` text PRIMARY KEY NOT NULL,
	`tripId` text NOT NULL,
	`lodgingLocationId` text NOT NULL,
	`checkIn` text NOT NULL,
	`checkOut` text NOT NULL,
	FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lodgingLocationId`) REFERENCES `Location`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `Trip` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sourceUrl` text,
	`numDays` integer,
	`startDate` text,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL,
	`updatedAt` text DEFAULT (datetime('now')) NOT NULL
);
