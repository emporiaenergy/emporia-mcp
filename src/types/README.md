# Types Directory

This directory contains TypeScript type definitions for the project.

## Files

### `api.ts`

Contains types related to the Emporia API responses and parameters:
- Interface definitions for API responses
- Parameter types for API service methods
- Data structures for various Emporia device types

### `mcp.ts`

Contains types specific to MCP (Model Context Protocol) tools:
- Parameter types for MCP tool functions
- Re-exports from api.ts that are needed for MCP tools

### `auth.ts`

Contains types for authentication-related structures:
- Authentication credentials interface
- Token response interfaces
- AWS Cognito auth result structure

## Type Organization

Types are organized to maintain a clear separation of concerns:

1. **API Types**: All types related to external API responses and service parameters.
2. **MCP Types**: Types specific to the MCP server tools.
3. **Authentication Types**: Types related to authentication.

This organization helps maintain clean code and easier refactoring when API changes occur. 