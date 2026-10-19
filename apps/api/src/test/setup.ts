// Testes usam bancos isolados: TEST_DATABASE_URL e TEST_REDIS_URL.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
