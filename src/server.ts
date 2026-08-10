import app from "./app.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { env } from "./config/env.js";

async function bootstrap() {
  await connectDB();

  const server = app.listen(env.PORT, () => {
    console.log(`🚀 Fiki Transit Backend running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    console.log(`📌 Health check: http://localhost:${env.PORT}/health`);
    console.log(`📌 Auth API:     http://localhost:${env.PORT}/api/v1/auth/login`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Gracefully shutting down...`);
    server.close(async () => {
      console.log("🔒 HTTP server closed.");
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});
