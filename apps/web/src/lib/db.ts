import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

declare global {
  var __argusDbPool: Pool | undefined;
}

let productionPool: Pool | undefined;

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to apps/web/.env.local (see apps/web/.env.example) or export it in the environment.",
    );
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "argus-web",
  });
}

/**
 * Return the process-wide pool. In development the pool is stored on
 * globalThis so Next.js hot reloads reuse it instead of opening a new one.
 */
export function getPool(): Pool {
  if (process.env.NODE_ENV === "production") {
    productionPool ??= createPool();
    return productionPool;
  }

  globalThis.__argusDbPool ??= createPool();
  return globalThis.__argusDbPool;
}

/** Run one parameterized query and return a typed result. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Run a callback inside a BEGIN/COMMIT block, rolling back on error. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Close pools so short-lived scripts can exit cleanly. */
export async function closePool(): Promise<void> {
  if (productionPool) {
    await productionPool.end();
    productionPool = undefined;
  }
  if (globalThis.__argusDbPool) {
    await globalThis.__argusDbPool.end();
    globalThis.__argusDbPool = undefined;
  }
}
