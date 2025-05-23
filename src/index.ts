import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CognitoAuthService } from "./services/auth.js";
import { EmporiaApiService } from "./services/api.js";
import { COGNITO_CLIENT_ID, COGNITO_URL } from "./config.js";
import { log } from "./utils/log.js";
import { registerEmporiaTools } from "./tools/emporia.js";
import { loadEnvironmentConfig } from "./env.js";

async function main(): Promise<void> {
  // Load environment configuration
  let config;
  try {
    config = loadEnvironmentConfig();
  } catch (error: any) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }

  // Create service instances
  const authService = new CognitoAuthService({
    account_email: config.account,
    password: config.password,
    clientId: COGNITO_CLIENT_ID,
    cognitoUrl: COGNITO_URL,
  });
  const apiService = new EmporiaApiService(authService);

  // Fetch auth token to verify that it's working correctly.
  try {
    await authService.initialize();

    log("Authentication service initialized successfully", null, "info", "SERVER");
  } catch (error: any) {
    log("Failed to initialize with environment credentials", { error: String(error) }, "error", "SERVER");
    console.error("Failed to initialize with environment credentials:", error);
    process.exit(1);
  }

  /**
   * Emporia MCP Server
   * Provides tools for interacting with Emporia Energy devices and usage data
   */
  const server = new McpServer({
    name: "emporia-mcp",
    version: "1.0.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // Register all Emporia tools with the server
  registerEmporiaTools(server, apiService);

  // Start the server with stdio transport
  const transport = new StdioServerTransport();

  // Add global error handler
  process.on("unhandledRejection", (reason, promise) => {
    log("Unhandled Rejection", { reason: String(reason) }, "error", "SERVER");
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
  });

  // Connect the server
  try {
    await server.connect(transport);
  } catch (error: any) {
    log("Failed to start server", { error: String(error) }, "error", "SERVER");
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
