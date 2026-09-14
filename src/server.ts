import app from './app';
import { connectDB, disconnectDB } from './config/db';
import { env } from './config/env';

const PORT = env.PORT || 8000;

const startServer = async () => {
  // Connect to DB before listening
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
  });

  // Graceful shutdown on SIGINT / SIGTERM
  const handleShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
};

startServer();