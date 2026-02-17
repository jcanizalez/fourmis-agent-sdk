/**
 * Query class — wraps the agent loop AsyncGenerator with control methods.
 */

import type {
  AgentMessage,
  Query,
  PermissionMode,
  QueryInitializationResult,
  SlashCommand,
  AccountInfo,
  RewindFilesResult,
  McpSetServersResult,
  SDKUserMessage,
} from "./types.ts";
import type { ModelInfo } from "./providers/types.ts";
import type { McpServerConfig, McpServerStatus } from "./mcp/types.ts";

export type QueryControlHandlers = {
  setPermissionMode?: (mode: PermissionMode) => Promise<void>;
  setModel?: (model?: string) => Promise<void>;
  setMaxThinkingTokens?: (maxThinkingTokens: number | null) => Promise<void>;
  initializationResult?: () => Promise<QueryInitializationResult>;
  supportedCommands?: () => Promise<SlashCommand[]>;
  supportedModels?: () => Promise<ModelInfo[]>;
  mcpServerStatus?: () => Promise<McpServerStatus[]>;
  accountInfo?: () => Promise<AccountInfo>;
  rewindFiles?: (userMessageId: string, options?: { dryRun?: boolean }) => Promise<RewindFilesResult>;
  reconnectMcpServer?: (serverName: string) => Promise<void>;
  toggleMcpServer?: (serverName: string, enabled: boolean) => Promise<void>;
  setMcpServers?: (servers: Record<string, McpServerConfig>) => Promise<McpSetServersResult>;
  streamInput?: (stream: AsyncIterable<SDKUserMessage>) => Promise<void>;
};

function unsupported(methodName: string): Promise<never> {
  return Promise.reject(new Error(`Query.${methodName} is not supported in this runtime yet.`));
}

/**
 * Create a Query that wraps an AsyncGenerator<AgentMessage> with control methods.
 */
export function createQuery(
  generator: AsyncGenerator<AgentMessage, void, undefined>,
  abortController: AbortController,
  controls?: QueryControlHandlers,
): Query {
  const query: Query = {
    // AsyncGenerator protocol
    next: generator.next.bind(generator),
    return: generator.return.bind(generator),
    throw: generator.throw.bind(generator),

    // AsyncIterable protocol
    [Symbol.asyncIterator]() {
      return this;
    },

    // Control methods
    async interrupt() {
      abortController.abort();
    },

    async setPermissionMode(mode) {
      if (!controls?.setPermissionMode) return unsupported("setPermissionMode");
      await controls.setPermissionMode(mode);
    },

    async setModel(model) {
      if (!controls?.setModel) return unsupported("setModel");
      await controls.setModel(model);
    },

    async setMaxThinkingTokens(maxThinkingTokens) {
      if (!controls?.setMaxThinkingTokens) return unsupported("setMaxThinkingTokens");
      await controls.setMaxThinkingTokens(maxThinkingTokens);
    },

    async initializationResult() {
      if (!controls?.initializationResult) return unsupported("initializationResult");
      return controls.initializationResult();
    },

    async supportedCommands() {
      if (!controls?.supportedCommands) return unsupported("supportedCommands");
      return controls.supportedCommands();
    },

    async supportedModels() {
      if (!controls?.supportedModels) return unsupported("supportedModels");
      return controls.supportedModels();
    },

    async mcpServerStatus() {
      if (!controls?.mcpServerStatus) return unsupported("mcpServerStatus");
      return controls.mcpServerStatus();
    },

    async accountInfo() {
      if (!controls?.accountInfo) return unsupported("accountInfo");
      return controls.accountInfo();
    },

    async rewindFiles(userMessageId, options) {
      if (!controls?.rewindFiles) return unsupported("rewindFiles");
      return controls.rewindFiles(userMessageId, options);
    },

    async reconnectMcpServer(serverName) {
      if (!controls?.reconnectMcpServer) return unsupported("reconnectMcpServer");
      await controls.reconnectMcpServer(serverName);
    },

    async toggleMcpServer(serverName, enabled) {
      if (!controls?.toggleMcpServer) return unsupported("toggleMcpServer");
      await controls.toggleMcpServer(serverName, enabled);
    },

    async setMcpServers(servers) {
      if (!controls?.setMcpServers) return unsupported("setMcpServers");
      return controls.setMcpServers(servers);
    },

    async streamInput(stream) {
      if (!controls?.streamInput) return unsupported("streamInput");
      await controls.streamInput(stream);
    },

    close() {
      abortController.abort();
      generator.return(undefined);
    },
  };

  return query;
}
