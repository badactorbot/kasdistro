import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  if (process.env.DATABASE_URL) {
    if (process.env.NODE_ENV !== "production") {
      void import("./lib/kron-automation-service").then(({ startAutomationScheduler }) => {
        startAutomationScheduler();
      });
    }
    void import("./lib/user-automation-service").then(({ startUserAutomationScheduler }) => {
      startUserAutomationScheduler();
    });
  }
});
