import { config } from "dotenv";
import { log } from "./utils/log.js";
export function loadEnvironmentConfig() {
    // Try to load from .env file if ENV_FILE is specified
    const envFilePath = process.env.ENV_FILE;
    if (envFilePath) {
        const result = config({ path: envFilePath });
        if (result.error) {
            log("Failed to load .env file", { path: envFilePath, error: result.error.message }, "error", "CONFIG");
        }
        else {
            log("Loaded environment from .env file", { path: envFilePath }, "info", "CONFIG");
        }
    }
    // Get credentials from environment variables
    const account = process.env.EMPORIA_ACCOUNT;
    const password = process.env.EMPORIA_PASSWORD;
    if (!account || !password) {
        log("Missing required environment variables", null, "error", "CONFIG");
        throw new Error("ERROR: Environment variables EMPORIA_ACCOUNT and EMPORIA_PASSWORD are required. " +
            "Either set them directly or provide them in a .env file specified by ENV_FILE. " +
            "See README.md for configuration instructions.");
    }
    return { account, password };
}
