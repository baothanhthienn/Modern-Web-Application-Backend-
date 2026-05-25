import pg from 'pg';

const { Pool } = pg;

export function createDatabase(config) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl
      ? { rejectUnauthorized: config.databaseSslRejectUnauthorized }
      : false,
  });

  return {
    query(text, parameters) {
      return pool.query(text, parameters);
    },
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close() {
      return pool.end();
    },
  };
}

