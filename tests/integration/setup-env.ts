process.env.DATABASE_URL ??= 'postgres://pglite/test';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef0123456789';
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.PLUGGY_WEBHOOK_SECRET ??= 'test-webhook-secret-0123456789abcdef';
process.env.JOBS_MODE = 'inline';
process.env.APP_URL ??= 'http://localhost:3000';
