import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Configure logging.
const LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../logs");
const LOG_FILE = path.join(LOG_DIR, `mcp-${new Date().toISOString().split("T")[0]}.log`);
/**
 * Maximum number of log files to keep.
 */
const MAX_LOG_FILES = 10;
/**
 * 10MB max log file size.
 */
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/**
 * Queue for batching log writes.
 */
let logQueue: string[] = [];
let logWriteTimeout: NodeJS.Timeout | null = null;
/**
 * Interval, in milliseconds, at which to flush logs.
 * Currently, once a second.
 */
const LOG_FLUSH_INTERVAL = 1000;

/**
 * Operation logs stored in memory
 */
export const operationLogs: string[] = [];
/**
 * Prevent operation logs from growing too large.
 */
const MAX_OPERATION_LOGS = 1000;

/**
 * Ensure log directory exists.
 */
function ensureLogDirectory(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Setup log rotation management.
 */
function setupLogRotation(): void {
  try {
    // Check if current log file exceeds max size.
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/:/g, "-");
      const rotatedLogFile = path.join(LOG_DIR, `mcp-${timestamp}.log`);
      fs.renameSync(LOG_FILE, rotatedLogFile);
    }

    // Clean up old log files if we have too many.
    const logFiles = fs
      .readdirSync(LOG_DIR)
      .filter((file) => file.startsWith("mcp-") && file.endsWith(".log"))
      .map((file) => path.join(LOG_DIR, file))
      .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());

    if (logFiles.length > MAX_LOG_FILES) {
      for (const file of logFiles.slice(MAX_LOG_FILES)) {
        try {
          fs.unlinkSync(file);
        } catch (err: any) {
          console.error(`Failed to delete old log file ${file}:`, err);
        }
      }
    }
  } catch (err: any) {
    console.error("Error in log rotation:", err);
  }
}

/**
 * Flush logs to disk asynchronously.
 */
async function flushLogs(): Promise<void> {
  if (logQueue.length === 0) {
    return;
  }

  const logsToWrite = logQueue.join("\n") + "\n";
  logQueue = [];
  logWriteTimeout = null;

  try {
    await fs.promises.appendFile(LOG_FILE, logsToWrite);
    // Check if we need to rotate logs after write.
    const stats = await fs.promises.stat(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      setupLogRotation();
    }
  } catch (err: any) {
    console.error("Failed to write logs to file:", err);
    // If write fails, try to use sync version as fallback.
    try {
      fs.appendFileSync(LOG_FILE, logsToWrite);
    } catch (syncErr: any) {
      console.error("Failed to write logs synchronously:", syncErr);
    }
  }
}

/**
 * Shared logging utility for consistent logging across the application.
 * @param message Log message.
 * @param data Optional data to include with the message.
 * @param level Log level (debug, info, error).
 * @param prefix Optional prefix for the log (defaults to 'MCP').
 */
export function log(message: string, data: any = null, level: "debug" | "info" | "error" = "info", prefix: string = "MCP"): void {
  const timestamp = new Date().toISOString();
  const logMsg = data ? `${message}: ${JSON.stringify(data, null, 2)}` : message;
  const formattedLog = `[${prefix} ${timestamp}] [${level.toUpperCase()}] ${logMsg}`;

  // Manage operation logs with size limit.
  operationLogs.push(formattedLog);
  if (operationLogs.length > MAX_OPERATION_LOGS) {
    // Keep most recent logs but trim the middle to maintain context.
    const firstLogs = operationLogs.slice(0, 100);
    const lastLogs = operationLogs.slice(operationLogs.length - (MAX_OPERATION_LOGS - 100));
    operationLogs.length = 0;
    operationLogs.push(...firstLogs);
    operationLogs.push(`[...${operationLogs.length - MAX_OPERATION_LOGS} logs truncated...]`);
    operationLogs.push(...lastLogs);
  }

  // Queue log for async writing.
  logQueue.push(formattedLog);

  // Setup timer to flush logs if not already scheduled.
  if (!logWriteTimeout) {
    logWriteTimeout = setTimeout(flushLogs, LOG_FLUSH_INTERVAL);
  }

  // Console output to stderr for debugging or errors.
  if (process.env.DEBUG || level === "error") {
    console.error(formattedLog);
  }
}

// Format logs for response.
export function formatLogResponse(logs: string[]): string {
  if (logs.length <= 100) {
    return logs.join("\n");
  }

  // For very long logs, include first and last parts with truncation notice.
  const first = logs.slice(0, 50);
  const last = logs.slice(-50);
  return [...first, `\n... ${logs.length - 100} more log entries (truncated) ...\n`, ...last].join("\n");
}

// Register handlers for process exit.
export function registerExitHandlers(): void {
  // Make sure logs are flushed when the process exits.
  process.on("exit", () => {
    if (logQueue.length > 0) {
      try {
        fs.appendFileSync(LOG_FILE, logQueue.join("\n") + "\n");
      } catch (err: any) {
        console.error("Failed to flush logs on exit:", err);
      }
    }
  });

  process.on("SIGINT", () => {
    // Flush logs and exit.
    if (logQueue.length > 0) {
      try {
        fs.appendFileSync(LOG_FILE, logQueue.join("\n") + "\n");
      } catch (err: any) {
        console.error("Failed to flush logs on SIGINT:", err);
      }
    }
    process.exit(0);
  });
}

// Initialize logging.
ensureLogDirectory();
setupLogRotation();
registerExitHandlers();

// Schedule periodic log rotation.
// Check every 15 minutes.
setInterval(
  () => {
    setupLogRotation();
  },
  15 * 60 * 1000,
);
