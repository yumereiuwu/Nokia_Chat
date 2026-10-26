const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env')
});

const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || Buffer.byteLength(SESSION_SECRET, 'utf8') < 32) {
  console.error(
    'SESSION_SECRET phải có ít nhất 32 byte. Hãy cập nhật .env.'
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Thiếu DATABASE_URL trong file .env.');
  process.exit(1);
}

let databaseUrl;

try {
  const parsedUrl = new URL(process.env.DATABASE_URL);
  parsedUrl.searchParams.delete('channel_binding');
  parsedUrl.searchParams.set('sslmode', 'verify-full');
  databaseUrl = parsedUrl.toString();
} catch {
  console.error('DATABASE_URL không đúng định dạng.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
  max: 10
});

pool.on('error', (err) => {
  console.error('Lỗi kết nối database:', err.code || 'UNKNOWN');
});

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'legacy')));

app.use(cookieSession({
  name: 'yume_session',
  keys: [SESSION_SECRET],
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Yume Chat API',
    status: 'running',
    healthEndpoint: '/api/health'
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'ok',
      database: 'connected'
    });
  } catch (err) {
    console.error('Health check lỗi:', err.code || 'UNKNOWN');
    res.status(503).json({
      status: 'error',
      database: 'unavailable'
    });
  }
});

// Thông tin phiên đăng nhập hiện tại
app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: req.session.user
  });
});

// Đăng ký
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { username, displayName, password } = req.body || {};

  if (
    typeof username !== 'string' ||
    typeof displayName !== 'string' ||
    typeof password !== 'string'
  ) {
    return res.status(400).json({
      error: 'Vui lòng nhập username, displayName và password.'
    });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedDisplayName = displayName.trim();

  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
    return res.status(400).json({
      error: 'Username dài 3–24 ký tự, chỉ gồm chữ thường, số và _.'
    });
  }

  if (
    normalizedDisplayName.length < 1 ||
    normalizedDisplayName.length > 60
  ) {
    return res.status(400).json({
      error: 'Tên hiển thị phải dài từ 1 đến 60 ký tự.'
    });
  }

  const passwordBytes = Buffer.byteLength(password, 'utf8');

  if (passwordBytes < 8 || passwordBytes > 72) {
    return res.status(400).json({
      error: 'Mật khẩu phải dài ít nhất 8 byte và tối đa 72 byte.'
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name, created_at`,
      [normalizedUsername, normalizedDisplayName, passwordHash]
    );

    const row = result.rows[0];
    const user = {
      id: row.id,
      username: row.username,
      displayName: row.display_name
    };

    req.session = { user };

    res.status(201).json({
      message: 'Đăng ký thành công.',
      user
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Username này đã được sử dụng.'
      });
    }

    console.error('Lỗi đăng ký:', err.code || 'UNKNOWN');
    res.status(500).json({
      error: 'Không thể đăng ký lúc này.'
    });
  }
});

// Đăng nhập
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.length > 100 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(400).json({
      error: 'Thông tin đăng nhập không hợp lệ.'
    });
  }

  try {
    const normalizedUsername = username.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, username, display_name, password_hash
       FROM users
       WHERE username = $1`,
      [normalizedUsername]
    );

    const row = result.rows[0];

    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({
        error: 'Username hoặc mật khẩu không đúng.'
      });
    }

    const user = {
      id: row.id,
      username: row.username,
      displayName: row.display_name
    };

    req.session = { user };

    res.json({
      message: 'Đăng nhập thành công.',
      user
    });
  } catch (err) {
    console.error('Lỗi đăng nhập:', err.code || 'UNKNOWN');
    res.status(500).json({
      error: 'Không thể đăng nhập lúc này.'
    });
  }
});

// Đăng xuất
app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ message: 'Đã đăng xuất.' });
});

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.id) {
    return res.status(401).json({
      error: 'Bạn cần đăng nhập để tìm người dùng.'
    });
  }

  next();
}

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

app.get('/api/users/search', requireAuth, searchLimiter, async (req, res) => {
  const rawQuery = req.query.q;

  if (typeof rawQuery !== 'string') {
    return res.status(400).json({
      error: 'Hãy nhập username cần tìm.'
    });
  }

  const query = rawQuery.trim().replace(/^@/, '').toLowerCase();

  if (query.length < 2 || query.length > 24 ||
      !/^[a-z0-9_]+$/.test(query)) {
    return res.status(400).json({
      error: 'Nhập ít nhất 2 ký tự; chỉ dùng chữ thường, số và _.'
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, display_name
       FROM users
       WHERE LEFT(username, LENGTH($1)) = $1
         AND id <> $2
       ORDER BY username
       LIMIT 20`,
      [query, req.session.user.id]
    );

    res.set('Cache-Control', 'no-store');

    res.json({
      users: result.rows.map(row => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name
      }))
    });
  } catch (err) {
    console.error('Lỗi tìm kiếm người dùng:', err.code || 'UNKNOWN');

    res.status(500).json({
      error: 'Không thể tìm người dùng lúc này.'
    });
  }
});
function isValidPgBigint(value, allowZero = false) {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
    return false;
  }

  try {
    const n = BigInt(value);
    return n <= 9223372036854775807n &&
      (allowZero ? n >= 0n : n > 0n);
  } catch {
    return false;
  }
}

const messagingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});

// Tạo hoặc lấy cuộc trò chuyện riêng với một username
app.post('/api/conversations/direct',
  requireAuth, messagingLimiter, async (req, res) => {
    const username = typeof req.body?.username === 'string'
      ? req.body.username.trim().replace(/^@/, '').toLowerCase()
      : '';

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: 'Username không hợp lệ.'
      });
    }

    const meId = String(req.session.user.id);

    try {
      const targetResult = await pool.query(
        `SELECT id, username, display_name
         FROM users
         WHERE username = $1`,
        [username]
      );

      if (targetResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Không tìm thấy người dùng.'
        });
      }

      const target = targetResult.rows[0];
      const targetId = String(target.id);

      if (targetId === meId) {
        return res.status(400).json({
          error: 'Bạn không thể tạo cuộc trò chuyện với chính mình.'
        });
      }

      const lowId = BigInt(meId) < BigInt(targetId)
        ? meId : targetId;
      const highId = BigInt(meId) < BigInt(targetId)
        ? targetId : meId;

      // Cùng một cặp người dùng luôn có cùng khóa cuộc trò chuyện.
      const directKey = `${lowId}:${highId}`;
      const client = await pool.connect();

      let conversationId;

      try {
        await client.query('BEGIN');

        const conversationResult = await client.query(
          `INSERT INTO conversations (kind, direct_key, created_by)
           VALUES ('direct', $1, $2)
           ON CONFLICT (direct_key)
           DO UPDATE SET direct_key = EXCLUDED.direct_key
           RETURNING id`,
          [directKey, meId]
        );

        conversationId = String(conversationResult.rows[0].id);

        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [conversationId, meId]
        );

        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [conversationId, targetId]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      res.set('Cache-Control', 'no-store');

      res.json({
        conversation: {
          id: conversationId,
          kind: 'direct',
          otherUser: {
            id: targetId,
            username: target.username,
            displayName: target.display_name
          }
        }
      });
    } catch (err) {
      console.error('Lỗi tạo cuộc trò chuyện:', err.code || 'UNKNOWN');
      res.status(500).json({
        error: 'Không thể tạo cuộc trò chuyện lúc này.'
      });
    }
  }
);

// Danh sách các cuộc trò chuyện của tài khoản hiện tại
app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    const meId = String(req.session.user.id);

    const result = await pool.query(
      `SELECT
         c.id, c.kind, c.title, c.created_at,
         other.id AS other_user_id,
         other.username AS other_username,
         other.display_name AS other_display_name,
         last_message.id AS last_message_id,
         last_message.body AS last_message_body,
         last_message.sender_id AS last_message_sender_id,
         last_message.created_at AS last_message_created_at
       FROM conversations c
       JOIN conversation_members mine
         ON mine.conversation_id = c.id
        AND mine.user_id = $1
       LEFT JOIN LATERAL (
         SELECT u.id, u.username, u.display_name
         FROM conversation_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.conversation_id = c.id
           AND cm.user_id <> $1
         ORDER BY u.username
         LIMIT 1
       ) other ON TRUE
       LEFT JOIN LATERAL (
         SELECT m.id, m.body, m.sender_id, m.created_at
         FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.id DESC
         LIMIT 1
       ) last_message ON TRUE
       ORDER BY COALESCE(last_message.created_at, c.created_at) DESC
       LIMIT 100`,
      [meId]
    );

    res.set('Cache-Control', 'no-store');

    res.json({
      conversations: result.rows.map(row => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        createdAt: row.created_at,
        otherUser: row.other_user_id ? {
          id: row.other_user_id,
          username: row.other_username,
          displayName: row.other_display_name
        } : null,
        lastMessage: row.last_message_id ? {
          id: row.last_message_id,
          body: row.last_message_body,
          senderId: row.last_message_sender_id,
          createdAt: row.last_message_created_at
        } : null
      }))
    });
  } catch (err) {
    console.error('Lỗi danh sách cuộc trò chuyện:', err.code || 'UNKNOWN');
    res.status(500).json({
      error: 'Không thể tải danh sách cuộc trò chuyện.'
    });
  }
});

// Nhận các tin nhắn mới hơn ID cuối cùng mà máy khách đã nhận.
// Lần đầu bỏ after để bắt đầu từ ID 0.
app.get('/api/conversations/:conversationId/messages',
  requireAuth, messagingLimiter, async (req, res) => {
    const conversationId = req.params.conversationId;
    const after = req.query.after === undefined
      ? '0' : req.query.after;

    if (!isValidPgBigint(conversationId)) {
      return res.status(400).json({
        error: 'ID cuộc trò chuyện không hợp lệ.'
      });
    }

    if (!isValidPgBigint(after, true)) {
      return res.status(400).json({
        error: 'Tham số after không hợp lệ.'
      });
    }

    const meId = String(req.session.user.id);

    try {
      const member = await pool.query(
        `SELECT 1
         FROM conversation_members
         WHERE conversation_id = $1
           AND user_id = $2`,
        [conversationId, meId]
      );

      if (member.rows.length === 0) {
        return res.status(404).json({
          error: 'Không tìm thấy cuộc trò chuyện.'
        });
      }

      const result = await pool.query(
        `SELECT id, conversation_id, sender_id, body, created_at
         FROM messages
         WHERE conversation_id = $1
           AND id > $2
         ORDER BY id ASC
         LIMIT 100`,
        [conversationId, after]
      );

      res.set('Cache-Control', 'no-store');

      res.json({
        messages: result.rows.map(row => ({
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          body: row.body,
          createdAt: row.created_at
        }))
      });
    } catch (err) {
      console.error('Lỗi tải tin nhắn:', err.code || 'UNKNOWN');
      res.status(500).json({
        error: 'Không thể tải tin nhắn lúc này.'
      });
    }
  }
);

// Gửi tin nhắn
app.post('/api/conversations/:conversationId/messages',
  requireAuth, messagingLimiter, async (req, res) => {
    const conversationId = req.params.conversationId;

    if (!isValidPgBigint(conversationId)) {
      return res.status(400).json({
        error: 'ID cuộc trò chuyện không hợp lệ.'
      });
    }

    if (typeof req.body?.body !== 'string') {
      return res.status(400).json({
        error: 'Nội dung tin nhắn không hợp lệ.'
      });
    }

    const body = req.body.body.trim();

    if (body.length === 0 || [...body].length > 4000) {
      return res.status(400).json({
        error: 'Tin nhắn phải có từ 1 đến 4000 ký tự.'
      });
    }

    const meId = String(req.session.user.id);

    try {
      const member = await pool.query(
        `SELECT 1
         FROM conversation_members
         WHERE conversation_id = $1
           AND user_id = $2`,
        [conversationId, meId]
      );

      if (member.rows.length === 0) {
        return res.status(404).json({
          error: 'Không tìm thấy cuộc trò chuyện.'
        });
      }

      const result = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, conversation_id, sender_id, body, created_at`,
        [conversationId, meId, body]
      );

      const row = result.rows[0];

      res.status(201).json({
        message: {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          body: row.body,
          createdAt: row.created_at
        }
      });
    } catch (err) {
      console.error('Lỗi gửi tin nhắn:', err.code || 'UNKNOWN');
      res.status(500).json({
        error: 'Không thể gửi tin nhắn lúc này.'
      });
    }
  }
);
const server = app.listen(PORT, () => {
  console.log(`Yume Chat API đang chạy tại http://localhost:${PORT}`);
});

async function shutdown() {
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);



