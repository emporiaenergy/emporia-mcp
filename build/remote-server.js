#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import { EmporiaApiService } from "./services/api.js";
import { log } from "./utils/log.js";
import { registerEmporiaTools } from "./tools/emporia.js";
import { randomUUID } from "crypto";
async function main() {
    const AUTH_URL = process.env.EMPORIA_AUTH_ORIGIN || "https://auth.emporiaenergy.com";
    const MCP_URL = process.env.EMPORIA_MCP_ORIGIN || "https://mcp.emporiaenergy.com";
    const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || "4qte47jbstod8apnfic0bunmrq";
    // Store pending OAuth requests
    const pendingOAuthRequests = new Map();
    const apiService = new EmporiaApiService(null);
    /**
     * Emporia MCP Server
     * Provides tools for interacting with Emporia Energy devices and usage data
     */
    const server = new McpServer({
        name: "emporia-mcp",
        version: "0.2.0",
        capabilities: {
            resources: {},
            tools: {},
        },
    });
    // Register all Emporia tools with the server
    registerEmporiaTools(server, apiService);
    // Add global error handler
    process.on("unhandledRejection", (reason) => {
        log("Unhandled Rejection", { reason: String(reason) }, "error");
    });
    // Map of MCP session IDs to transports
    const transports = {
        streamable: {},
        sse: {},
    };
    /**
     * Emporia Remote MCP Express Server
     * Exposes Emporia energy monitoring data via the MCP protocol for LLM integration. Supports SSE and Streamable HTTP transport types.
     * This server is reachable at https://mcp.emporiaenergy.com/sse (SSE) and https://mcp.emporiaenergy.com/streamable (Streamable HTTP).
     */
    const app = express();
    const PORT = 50061;
    app.use(cors());
    // StreamableHttp endpoint
    app.all("/streamable", express.json(), async (req, res) => {
        try {
            const sessionId = req.headers["mcp-session-id"];
            let transport;
            if (sessionId && transports.streamable[sessionId]) {
                // Reuse existing transport
                transport = transports.streamable[sessionId];
            }
            else if (!sessionId && isInitializeRequest(req.body)) {
                // Create the StreamableHttp transport
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sessionId) => {
                        transports.streamable[sessionId] = transport;
                    },
                });
                transport.onclose = () => {
                    if (transport.sessionId) {
                        delete transports.streamable[transport.sessionId];
                    }
                };
                // Connect the server to this transport
                await server.connect(transport);
            }
            else {
                return res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "Bad Request: No valid session ID provided",
                    },
                    id: null,
                });
            }
            const authorization = req.headers["authorization"];
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
            req.auth = {
                token: authorization,
                clientId: "",
                scopes: [],
            };
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
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
            // Handle client disconnect
            req.on("close", () => {
                delete transports.sse[transport.sessionId];
            });
            await server.connect(transport);
        }
        catch (error) {
            log("Error in legacy SSE endpoint", error, "error");
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal server error" });
            }
        }
    });
    // Clients using SSE are directed to POST messages to this endpoint
    app.post("/messages", async (req, res) => {
        try {
            const sessionId = req.query.sessionId;
            if (!sessionId) {
                res.status(400).json({ error: "sessionId is required" });
                return;
            }
            const transport = transports.sse[sessionId];
            if (!transport) {
                res.status(404).json({ error: "Session not found" });
                return;
            }
            const authorization = req.headers["authorization"];
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
            req.auth = {
                token: authorization,
                clientId: "",
                scopes: [],
            };
            await transport.handlePostMessage(req, res);
        }
        catch (error) {
            log("Error in legacy messages endpoint", error, "error");
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal server error" });
            }
        }
    });
    // OAuth resource metadata
    app.get("/.well-known/oauth-protected-resource", (req, res) => {
        const metadata = {
            resource: MCP_URL + "/streamable",
            authorization_servers: [MCP_URL],
            bearer_methods_supported: ["header"],
        };
        res.json(metadata);
    });
    // OAuth resource metadata
    app.get("/.well-known/oauth-protected-resource/:transport", (req, res) => {
        const transport = req.params.transport;
        if (!transport || (transport !== "sse" && transport !== "streamable")) {
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
    app.get("/.well-known/oauth-authorization-server", (req, res) => {
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
    app.post("/oauth/register", express.json(), (req, res) => {
        res.json({
            client_id: COGNITO_CLIENT_ID,
            redirect_uris: req.body.redirect_uris,
        });
    });
    app.get("/oauth/authorize", (req, res) => {
        const { redirect_uri, client_id, code_challenge, code_challenge_method } = req.query;
        if (!redirect_uri || !client_id) {
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
    app.get("/oauth/callback", (req, res) => {
        const { code, state, error, error_description } = req.query;
        // Retrieve the original OAuth session
        const sessionId = state;
        const session = sessionId ? pendingOAuthRequests.get(sessionId) : null;
        if (!session) {
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
        res.status(400).json({
            error: "invalid_request",
            error_description: "No authorization code received",
        });
    });
    app.post("/oauth/token", express.urlencoded({ extended: true }), async (req, res) => {
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
        }
        catch (error) {
            log("OAuth token request failed", error, "error");
            res.status(500).json({ error: "Failed to fetch OAuth token" });
        }
    });
    // Health check endpoint
    app.get("/debug/health", (req, res) => {
        res.status(200).json({ status: "OK" });
    });
    app.listen(PORT, () => {
        log(`Server running on http://localhost:${PORT}`, {}, "debug");
    });
    return app;
}
main();
