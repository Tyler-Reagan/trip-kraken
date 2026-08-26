ALTER TABLE `LegModePin` RENAME TO `JourneyRoadKind`;
--> statement-breakpoint
ALTER TABLE `JourneyRoadKind` RENAME COLUMN `mode` TO `kind`;
--> statement-breakpoint
DROP INDEX `leg_mode_pin_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `journey_road_kind_unique` ON `JourneyRoadKind` (`tripId`,`locationAId`,`locationBId`);
