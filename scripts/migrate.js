import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { createDatabase } from '../src/db.js';

const db = createDatabase(config);

try {
  const sql = await readFile(new URL('../migrations/001_auth_schema.sql', import.meta.url), 'utf8');
  await db.query(sql);
  console.log('PostgreSQL authentication schema is ready.');
} finally {
  await db.close();
}

