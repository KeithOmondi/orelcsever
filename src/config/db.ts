import { Pool, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' || env.DATABASE_URL.includes('neon.tech') 
    ? { rejectUnauthorized: false } 
    : false,
  connectionTimeoutMillis: 20000, 
  idleTimeoutMillis: 30000,
  max: 10,
  options: '-c timezone=Africa/Nairobi',
});

// ✅ Generic query helper — used by services throughout the app
export const query = <T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};

// ✅ Explicit named export
export const connectDB = async (): Promise<void> => {
  try {
    console.log('🐘 Attempting to connect to PostgreSQL...');
    const client = await pool.connect();
    
    const res = await client.query('SELECT NOW()');
    console.log(`✅ PostgreSQL connected! Server time: ${res.rows[0].now}`);
    
    client.release();
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:');
    console.error(error);
    process.exit(1);
  }
};

// ✅ Explicit named export
export const disconnectDB = async (): Promise<void> => {
  await pool.end();
  console.log('🔌 PostgreSQL pool has been disconnected');
};