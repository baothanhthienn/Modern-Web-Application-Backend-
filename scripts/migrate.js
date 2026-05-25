import { readdir, readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { createDatabase } from '../src/db.js';

const db = createDatabase(config);
const migrationsUrl = new URL('../migrations/', import.meta.url);

try {
  const filenames = (await readdir(migrationsUrl))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  for (const filename of filenames) {
    const sql = await readFile(new URL(filename, migrationsUrl), 'utf8');
    await db.query(sql);
    console.log(`Applied migration ${filename}.`);
  }

  console.log('PostgreSQL schema is ready.');
} finally {
  await db.close();
}
