import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

async function testPersistent() {
  const dataDir = path.resolve('.pgdata');
  const client = new PGlite(dataDir);
  await client.waitReady;

  const check = await client.query<{ tbl: string | null }>("SELECT to_regclass('organizations')::text as tbl;");
  console.log('Table check:', check.rows[0]);
  if (!check.rows[0]?.tbl) {
    console.log('Running migration...');
    const sql = fs.readFileSync('drizzle/0000_omniscient_echo.sql', 'utf8');
    for (const s of sql.split('--> statement-breakpoint')) {
      if (s.trim()) await client.exec(s.trim());
    }
    console.log('Migration completed!');
  } else {
    console.log('Schema already exists.');
  }

  const res = await client.query('SELECT count(*) FROM organizations;');
  console.log('Organizations in .pgdata:', res.rows[0]);
  await client.close();
}

testPersistent().catch(console.error);
