import { createClient } from '@libsql/client';
import { drizzle as drizzleLibsql, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import * as schema from './schema';
import fs from 'fs';
import path from 'path';

function getD1Binding(): any {
  const d1 = (globalThis as any).DB ?? (process.env as any).DB;
  if (d1 && typeof d1 === 'object' && typeof d1.prepare === 'function') {
    return d1;
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

export * from './schema';
