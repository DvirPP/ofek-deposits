const { AsyncLocalStorage } = require("async_hooks");
const { types, Pool } = require("pg");
const { config } = require("../config");

types.setTypeParser(1082, (value) => value);

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      options: "-c search_path=deposits",
    });
    this.transactions = new AsyncLocalStorage();
  }

  client() {
    return this.transactions.getStore() ?? this.pool;
  }

  query(text, params) {
    return this.client().query(text, params);
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.transactions.run(client, work);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async waitUntilReady() {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await this.pool.query("SELECT 1");
        return;
      } catch (error) {
        if (attempt === 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

module.exports = new Database();
