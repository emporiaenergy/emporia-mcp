#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { Application, Request, Response } from "express";
import cors from "cors";
import { EmporiaApiService } from "./services/api.js";
import { log } from "./utils/log.js";
import { registerEmporiaTools } from "./tools/emporia.js";
import { randomUUID } from "crypto";

async function main(): Promise<Application> {
  const AUTH_URL = process.env.EMPORIA_AUTH_ORIGIN || "https://auth.emporiaenergy.com";
  const MCP_URL = process.env.EMPORIA_MCP_ORIGIN || "https://mcp.emporiaenergy.com";
  const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || "4qte47jbstod8apnfic0bunmrq";

  // Store pending OAuth requests
  const pendingOAuthRequests = new Map<
    string,
    {
      redirect_uri: string;
      client_id: string;
      code_challenge?: string;
      code_challenge_method?: string;
    }
  >();

  const apiService = new EmporiaApiService(null);

  /**
   * Creates a new Emporia MCP Server instance.
   *
   * IMPORTANT: A given McpServer/Server instance can only be connected to a single
   * transport at a time (connect() overwrites the previous transport). Since this
   * remote server handles many concurrent client sessions, each session MUST get
   * its own McpServer instance — never share one server across multiple transports,
   * or sessions will hang, swap JSON-RPC replies, or leak each other's tool results.
   */
  function createMcpServer(): McpServer {
    const server = new McpServer({
      name: "emporia-mcp",
      version: "0.2.1",
      capabilities: {
        resources: {},
        tools: {},
      },
    });

    // Register all Emporia tools with the server
    registerEmporiaTools(server, apiService);

    return server;
  }

  // Add global error handler
  process.on("unhandledRejection", (reason) => {
    log("Unhandled Rejection", { reason: String(reason) }, "error");
  });

  // Map of MCP session IDs to transports
  const transports = {
    streamable: {} as Record<string, StreamableHTTPServerTransport>,
    sse: {} as Record<string, SSEServerTransport>,
  };

  // Streamable HTTP sessions don't always end with an explicit DELETE (e.g. a client that
  // crashes, or one that creates a short-lived client per request/message — as GeminiAdapter
  // does — and doesn't reliably terminate it), which would otherwise leak the transport and
  // its per-session McpServer forever. Track each session's McpServer + last-activity time
  // alongside its transport so an idle sweep can evict sessions that have gone silent.
  const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const streamableSessionInfo = {} as Record<string, { server: McpServer; lastActivity: number }>;

  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, info] of Object.entries(streamableSessionInfo)) {
      if (now - info.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
        log(`Closing idle streamable session ${sessionId}`, null, "info", "EXPRESS");
        // Closing the transport triggers its onclose handler, which cleans up
        // transports.streamable/streamableSessionInfo and closes the McpServer.
        transports.streamable[sessionId]?.close().catch((error) => {
          log(`Error closing idle transport for streamable session ${sessionId}`, error, "error");
        });
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS).unref();

  /**
   * Emporia Remote MCP Express Server
   * Exposes Emporia energy monitoring data via the MCP protocol for LLM integration. Supports SSE and Streamable HTTP transport types.
   * This server is reachable at https://mcp.emporiaenergy.com/sse (SSE) and https://mcp.emporiaenergy.com/streamable (Streamable HTTP).
   */
  const app: Application = express();
  const PORT: number = 50061;

  app.use(cors());

  // StreamableHttp endpoint
  app.all("/streamable", express.json(), async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.streamable[sessionId]) {
        // Reuse existing transport
        transport = transports.streamable[sessionId];

        // Check auth before touching the transport for an existing session.
        const authorization = req.headers["authorization"] as string;
        if (!authorization || !authorization.startsWith("Bearer ")) {
          log(`/streamable: Missing or invalid Authorization header: ${authorization}`, null, "error", "EXPRESS");
          return res.status(401).json({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "Unauthorized: Missing or invalid Authorization header",
            },
            id: null,
          });
        }

        // Add token to request AuthInfo. clientId and scopes are required but unused.
        (req as any).auth = {
          token: authorization,
          clientId: "",
          scopes: [],
        };

        // Refresh the idle timer so an actively-used session is never swept.
        if (streamableSessionInfo[sessionId]) {
          streamableSessionInfo[sessionId].lastActivity = Date.now();
        }
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // Check auth BEFORE creating or connecting a new transport, so an unauthenticated
        // initialize never touches a server/transport pair.
        const authorization = req.headers["authorization"] as string;
        if (!authorization || !authorization.startsWith("Bearer ")) {
          log(`/streamable: Missing or invalid Authorization header: ${authorization}`, null, "error", "EXPRESS");
          return res.status(401).json({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "Unauthorized: Missing or invalid Authorization header",
            },
            id: null,
          });
        }

        // Add token to request AuthInfo. clientId and scopes are required but unused.
        (req as any).auth = {
          token: authorization,
          clientId: "",
          scopes: [],
        };

        // Each session gets its own McpServer instance so concurrent sessions never share
        // (and overwrite) a single transport connection.
        const sessionServer = createMcpServer();

        // Create the StreamableHttp transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            transports.streamable[sessionId] = transport;
            streamableSessionInfo[sessionId] = { server: sessionServer, lastActivity: Date.now() };
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport.sessionId;
          if (closedSessionId) {
            delete transports.streamable[closedSessionId];
            delete streamableSessionInfo[closedSessionId];
          }
          sessionServer.close().catch((error) => {
            log(`Error closing McpServer for streamable session ${closedSessionId}`, error, "error");
          });
        };

        await sessionServer.connect(transport);
      } else {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log("Error in StreamableHttp endpoint", error, "error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Legacy SSE endpoint for older clients
  app.get("/sse", async (req, res) => {
    try {
      // Create SSE transport for legacy clients
      const transport = new SSEServerTransport("/messages", res);
      transports.sse[transport.sessionId] = transport;

      // Each session gets its own McpServer instance so concurrent sessions never share
      // (and overwrite) a single transport connection.
      const sessionServer = createMcpServer();

      // Handle client disconnect. Unlike streamable sessions, SSE keeps a single long-lived
      // HTTP connection open for the life of the session, so "close" reliably fires when the
      // client disconnects (no idle sweep needed) — but the per-session McpServer still needs
      // to be closed explicitly here, or it (and its tool handlers) leaks forever.
      req.on("close", () => {
        delete transports.sse[transport.sessionId];
        sessionServer.close().catch((error) => {
          log(`Error closing McpServer for SSE session ${transport.sessionId}`, error, "error");
        });
      });

      await sessionServer.connect(transport);
    } catch (error) {
      log("Error in legacy SSE endpoint", error, "error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Clients using SSE are directed to POST messages to this endpoint
  app.post("/messages", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const transport = transports.sse[sessionId];

      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const authorization = req.headers["authorization"] as string;
      if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized: Missing or invalid Authorization header",
          },
          id: null,
        });
      }

      // Add token to request AuthInfo. clientId and scopes are required but unused.
      (req as any).auth = {
        token: authorization,
        clientId: "",
        scopes: [],
      };

      await transport.handlePostMessage(req, res);
    } catch (error) {
      log("Error in legacy messages endpoint", error, "error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // OAuth resource metadata
  app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
    const metadata = {
      resource: MCP_URL + "/streamable",
      authorization_servers: [MCP_URL],
      bearer_methods_supported: ["header"],
    };
    res.json(metadata);
  });

  // OAuth resource metadata
  app.get("/.well-known/oauth-protected-resource/:transport", (req: Request, res: Response) => {
    const transport = req.params.transport;
    if (!transport || (transport !== "sse" && transport !== "streamable")) {
      log(`/.well-known/oauth-protected-resource/:transport: unknown transport ${transport}`, null, "error", "EXPRESS");
      return res.status(404);
    }

    const metadata = {
      resource: MCP_URL + "/" + transport,
      authorization_servers: [MCP_URL],
      bearer_methods_supported: ["header"],
    };
    res.json(metadata);
  });

  // OAuth server metadata
  app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
    const oauthMetadata = {
      issuer: MCP_URL,
      authorization_endpoint: MCP_URL + "/oauth/authorize",
      token_endpoint: MCP_URL + "/oauth/token",
      registration_endpoint: MCP_URL + "/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
    res.status(200).json(oauthMetadata);
  });

  app.post("/oauth/register", express.json(), (req: Request, res: Response) => {
    res.json({
      client_id: COGNITO_CLIENT_ID,
      redirect_uris: req.body.redirect_uris,
    });
  });

  app.get("/oauth/authorize", (req: Request, res: Response) => {
    const { redirect_uri, client_id, code_challenge, code_challenge_method } = req.query as Record<string, string>;

    if (!redirect_uri || !client_id) {
      log(`/oauth/authorize: Missing required parameters: redirect_uri=${redirect_uri}; client_id=${client_id}`, null, "error", "EXPRESS");
      return res.status(400).json({ error: "Missing required parameters: redirect_uri and client_id" });
    }

    // Generate a unique state to track this request
    const internalState = randomUUID();

    // Store the original request parameters
    pendingOAuthRequests.set(internalState, {
      redirect_uri,
      client_id,
      code_challenge,
      code_challenge_method,
    });

    // Build params for Cognito with our callback URI
    const cognitoParams = new URLSearchParams({
      response_type: "code",
      client_id: COGNITO_CLIENT_ID,
      redirect_uri: `${MCP_URL}/oauth/callback`,
      state: internalState,
      ...(code_challenge && { code_challenge }),
      ...(code_challenge_method && { code_challenge_method }),
    });

    res.redirect(`${AUTH_URL}/oauth2/authorize?${cognitoParams.toString()}`);
  });

  // New callback endpoint to handle Cognito's response
  app.get("/oauth/callback", (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    // Retrieve the original OAuth session
    const sessionId = state;
    const session = sessionId ? pendingOAuthRequests.get(sessionId) : null;

    if (!session) {
      log(`/oauth/callback: invalid or expired session: ${sessionId}`, null, "error", "EXPRESS");
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Invalid or expired session",
      });
    }

    // Clean up the session
    pendingOAuthRequests.delete(sessionId);

    // Handle authorization errors
    if (error) {
      const errorParams = new URLSearchParams({
        error,
        ...(error_description && { error_description }),
      });
      return res.redirect(`${session.redirect_uri}?${errorParams.toString()}`);
    }

    // Handle successful authorization
    if (code) {
      const successParams = new URLSearchParams({ code });
      return res.redirect(`${session.redirect_uri}?${successParams.toString()}`);
    }

    // Something went wrong
    log("/oauth/callback: No authorization code received", null, "error", "EXPRESS");
    res.status(400).json({
      error: "invalid_request",
      error_description: "No authorization code received",
    });
  });

  app.post("/oauth/token", express.urlencoded({ extended: true }), async (req: Request, res: Response) => {
    const body = { ...req.body };
    body.redirect_uri = `${MCP_URL}/oauth/callback`;
    const params = new URLSearchParams(body);

    try {
      // Request token from Cognito
      const response = await fetch(`${AUTH_URL}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      const data = await response.text();
      res.status(response.status).send(data);
    } catch (error) {
      log("OAuth token request failed", error, "error");
      res.status(500).json({ error: "Failed to fetch OAuth token" });
    }
  });

  // Health check endpoint
  app.get("/debug/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "OK" });
  });

  app.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`, {}, "debug");
  });

  return app;
}

main();
