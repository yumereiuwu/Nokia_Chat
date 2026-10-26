const fs = require('fs');
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env')
});
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Thiếu DATABASE_URL trong file .env');
  }

  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('channel_binding');
  url.searchParams.set('sslmode', 'verify-full');

  const pool = new Pool({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10000,
    max: 1
  });

  try {
    const schemaPath = path.join(
      __dirname, '..', 'database', 'schema.sql'
    );

    const sql = fs.readFileSync(schemaPath, 'utf8')
      .replace(/^\uFEFF/, '');

    await pool.query(sql);

    console.log('Tạo cấu trúc database thành công!');
    console.log('Đã kiểm tra: users, conversations,');
    console.log('conversation_members và messages.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Khởi tạo database thất bại.');
  console.error('Mã lỗi:', err.code || 'UNKNOWN');
  console.error('Chi tiết:', err.message);
  process.exitCode = 1;
});
