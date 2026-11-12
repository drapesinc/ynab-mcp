#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as ynab from "ynab";
import { isReadOnly, registerAll, registerTools, tools } from "./registry.js";
import * as SuggestCategoriesTool from "./tools/SuggestCategoriesTool.js";
import { loadProfiles, withProfiles } from "./profiles.js";
const server = new McpServer({
    name: "ynab-mcp-server",
    version: "0.9.0",
});
const readOnly = isReadOnly(process.env.YNAB_READ_ONLY);
// Fork addition: YNAB_PROFILES gives each tool a `profile` argument (see src/profiles.ts).
// Without it the server runs exactly as upstream, on YNAB_API_TOKEN.
const profiles = loadProfiles();
if (profiles) {
    const selected = tools.filter((tool) => !tool.requiresAiCategorization || SuggestCategoriesTool.isCategorySuggestionEnabled());
    registerTools(server, new ynab.API(""), withProfiles(selected, profiles), { readOnly });
    console.error(`YNAB MCP: profiles ${profiles.list.map((p) => p.name).join(", ")} (default ${profiles.defaultProfile})`);
}
else {
    const api = new ynab.API(process.env.YNAB_API_TOKEN || "");
    registerAll(server, api, { readOnly });
}
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`YNAB MCP server running on stdio${readOnly ? " (read-only)" : ""}`);
}
main().catch(console.error);
