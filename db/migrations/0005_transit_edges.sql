ALTER TABLE `Location` ADD `arriveAt` text;--> statement-breakpoint
ALTER TABLE `Location` ADD `departAt` text;--> statement-breakpoint
CREATE UNIQUE INDEX `arrival_per_trip` ON `Location` (`tripId`) WHERE "Location"."arriveAt" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `departure_per_trip` ON `Location` (`tripId`) WHERE "Location"."departAt" is not null;