-- Yume Chat migration 001: profiles, media and unread messages.
-- Safe to run against an existing database.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio VARCHAR(160) NOT NULL DEFAULT '';

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS last_read_message_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(10) NOT NULL DEFAULT 'text';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sticker_code VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_message_type_check'
      AND conrelid = 'messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'sticker'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_payload_check'
      AND conrelid = 'messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_payload_check
      CHECK (
        (message_type = 'text' AND media_url IS NULL AND sticker_code IS NULL)
        OR
        (message_type = 'image' AND media_url IS NOT NULL AND sticker_code IS NULL)
        OR
        (message_type = 'sticker' AND media_url IS NULL AND sticker_code IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages (conversation_id, id, sender_id);

