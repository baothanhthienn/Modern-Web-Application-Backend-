export class HealthService {
  constructor(db) {
    this.db = db;
  }

  async check() {
    const result = await this.db.query(
      'SELECT current_database() AS database_name, version() AS server_version',
    );
    const row = result.rows[0];
    return {
      success: true,
      database: 'connected',
      databaseName: row.database_name,
      serverVersion: row.server_version,
    };
  }
}

