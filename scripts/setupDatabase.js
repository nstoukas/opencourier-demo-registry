const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function setupDatabase() {
  const client = await pool.connect();

  try {
    console.log("Creating PostGIS extension...");
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis;");

    console.log("Creating instances table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS instances (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        link VARCHAR(1024) NOT NULL UNIQUE,
        websocket_link VARCHAR(1024) NOT NULL,
        region GEOMETRY(Geometry, 4326),
        image_url VARCHAR(1024),
        user_count INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_fetched_at TIMESTAMP
      );
    `);

    console.log("Creating index on status for faster queries...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);
    `);

    console.log("Creating index on link for lookups...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instances_link ON instances(link);
    `);

    console.log("Creating spatial index on region...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instances_region ON instances USING GIST(region);
    `);

    console.log("Database setup completed successfully!");
  } catch (error) {
    console.error("Error setting up database:", error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase();
