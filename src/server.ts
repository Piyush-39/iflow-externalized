import { createApiApp } from "./api/app.js";
import { logger } from "./utils/logger.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");

createApiApp().listen(port, () => logger.info("API", `Listening on http://localhost:${port}`));
