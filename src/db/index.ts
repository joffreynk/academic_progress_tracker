import Database from 'better-sqlite3';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';

const d1Binding = (globalThis as typeof globalThis & { DB?: unknown }).DB ?? (process.env as typeof process.env & { DB?: unknown }).DB;

export const db = d1Binding
  ? drizzleD1(d1Binding as any)
  : drizzleSqlite(new Database(process.env.DATABASE_URL || './.data/local.db'));
