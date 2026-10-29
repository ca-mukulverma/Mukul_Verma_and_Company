-- Team Chat was removed; its messages lived in Redis and this table was never used
DROP TABLE IF EXISTS "Message";

-- Its leftover notifications
DELETE FROM "Notification" WHERE "title" = 'New Team Chat Message';
