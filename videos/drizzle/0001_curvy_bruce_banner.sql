CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`sourceType` enum('mp4','youtube') NOT NULL,
	`sourceUrl` text,
	`videoStorageKey` varchar(512),
	`transcription` text,
	`content` text,
	`docxStorageKey` varchar(512),
	`pdfStorageKey` varchar(512),
	`status` enum('pending','uploading','transcribing','analyzing','generating','done','error') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`fileSizeBytes` bigint,
	`durationSeconds` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
