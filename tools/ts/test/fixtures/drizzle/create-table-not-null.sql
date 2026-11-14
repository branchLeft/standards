CREATE TABLE `tenants` (
	`domain` text PRIMARY KEY NOT NULL,
	`api_key_salt` text NOT NULL,
	`api_key_hash` text NOT NULL
);
