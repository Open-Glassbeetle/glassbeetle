INSERT INTO backup_policy (id, enabled, frequency, retention_count, target_directory, updated_at)
VALUES (1, 0, 'daily', 7, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));