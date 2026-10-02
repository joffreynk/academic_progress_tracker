import { createClient } from '@libsql/client';
import { drizzle as drizzleLibsql, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import * as schema from './schema';
import fs from 'fs';
import path from 'path';

function getD1Binding(): any {
  // Cloudflare bindings are objects, so they are not copied into process.env by the
  // OpenNext runtime. Read the request context first, then the usual globals.
  const context = (globalThis as any)[Symbol.for('__cloudflare-context__')];
  const candidates = [(globalThis as any).DB, context?.env?.DB, (process.env as any).DB];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && typeof candidate.prepare === 'function') {
      return candidate;
    }
  }
  return null;
}

let _dbInstance: any = null;

function createDbInstance() {
  const d1 = getD1Binding();
  if (d1) {
    return drizzleD1(d1, { schema });
  }

  const rawUrl = process.env.DATABASE_URL || 'file:./.data/local.db';
  if (rawUrl.startsWith('file:')) {
    const filePath = rawUrl.slice(5);
    const dir = path.dirname(path.resolve(filePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const client = createClient({
    url: rawUrl.startsWith('file:') || rawUrl.startsWith('http:') || rawUrl.startsWith('https:') || rawUrl.startsWith('libsql:')
      ? rawUrl
      : `file:${rawUrl}`,
  });
  return drizzleLibsql(client, { schema });
}

export function getDb(): LibSQLDatabase<typeof schema> {
  const d1 = getD1Binding();
  if (d1) {
    return drizzleD1(d1, { schema }) as any;
  }
  if (!_dbInstance) {
    _dbInstance = createDbInstance();
  }
  return _dbInstance;
}

export const db: LibSQLDatabase<typeof schema> = new Proxy({} as any, {
  get(_target, prop) {
    const instance = getDb();
    const value = (instance as any)[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

// D1 rejects `begin`, so interactive transactions are unavailable on Cloudflare.
// There we run the callback statements in order against the same connection
// (atomic on local SQLite via db.transaction); callers must tolerate a mid-way failure.
export async function runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  if (getD1Binding()) return fn(db as any);
  return (db as any).transaction(fn);
}

export * from './schema';
