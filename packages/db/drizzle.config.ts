import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://pagepulse:pagepulse@localhost:3306/pagepulse',
  },
  strict: true,
  verbose: true,
});
