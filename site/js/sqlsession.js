// One shared PostgreSQL database for the reader and the IDE, persisted in IndexedDB so tables
// created in module 6.02 are still there in module 6.09. "Reset database" wipes it.
import { createDb } from './runners/sql.js';

const DIR = 'idb://systems-mastery-lab';
let dbPromise = null;

export function getDb() {
  if (!dbPromise) dbPromise = createDb(DIR).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

export async function resetDb() {
  const db = await getDb();
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;`);
}

export function dbLoaded() { return !!dbPromise; }
