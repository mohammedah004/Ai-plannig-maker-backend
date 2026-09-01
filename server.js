import app from "./src/app.js";
import { env } from "./src/config/env.js";
import { logger } from "./src/utils/logger.js";

const PORT = env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 AI Marketing Planner Backend listening on port ${PORT} [${env.NODE_ENV}]`);
  logger.info(`👉 Health check URL: http://localhost:${PORT}/health`);
});

// Graceful Shutdown Handling
function handleShutdown(signal) {
  logger.info(`\n🛑 Received ${signal}. Gracefully closing HTTP server...`);
  
  server.close(() => {
    logger.info("✅ HTTP server closed. Process exiting.");
    process.exit(0);
  });

  // Force close after 10 seconds if lingering connections exist
  setTimeout(() => {
    logger.error("⚠️ Forcefully terminating server due to lingering connections.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "💥 Unhandled Rejection detected:");
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "💥 Uncaught Exception detected:");
  process.exit(1);
});
