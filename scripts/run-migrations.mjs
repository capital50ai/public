#!/usr/bin/env node

import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('ERROR: DATABASE_URL or SUPABASE_DB_URL env var required');
  process.exit(1);
}

const sql = postgres(dbUrl, {
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function runMigrations() {
  try {
    const migrationsDir = path.join(__dirname, '../supabase/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration(s)`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      console.log(`\n▶ Running ${file}...`);
      try {
        await sql.unsafe(content);
        console.log(`✓ ${file} completed`);
      } catch (err) {
        console.error(`✗ ${file} failed:`, err.message);
        throw err;
      }
    }

    console.log('\n✓ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();
