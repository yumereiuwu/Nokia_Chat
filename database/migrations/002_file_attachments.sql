BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS file_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'sticker', 'file'));

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_payload_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_payload_check
  CHECK (
    (
      message_type = 'text'
      AND media_url IS NULL
      AND sticker_code IS NULL
      AND file_name IS NULL
      AND file_mime_type IS NULL
      AND file_size IS NULL
    )
    OR
    (
      message_type = 'image'
      AND media_url IS NOT NULL
      AND sticker_code IS NULL
      AND file_name IS NULL
      AND file_mime_type IS NULL
      AND file_size IS NULL
    )
    OR
    (
      message_type = 'sticker'
      AND media_url IS NULL
      AND sticker_code IS NOT NULL
      AND file_name IS NULL
      AND file_mime_type IS NULL
      AND file_size IS NULL
    )
    OR
    (
      message_type = 'file'
      AND media_url IS NOT NULL
      AND sticker_code IS NULL
      AND file_name IS NOT NULL
      AND file_mime_type IS NOT NULL
      AND file_size > 0
      AND file_size <= 9437184
    )
  );

COMMIT;