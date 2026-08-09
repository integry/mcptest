import { UriTemplate, type Variables } from '@modelcontextprotocol/client';

export interface SavedCardConnectionOptions {
  serverUrl: string;
  useProxy?: boolean;
  oauthToken?: string | null;
  proxyUrl?: string;
  proxyAuthToken?: string;
}

export interface SavedCardConnectionPlan {
  connectionUrl: string;
  authToken?: string;
  targetHeaders?: HeadersInit;
  usesProxy: boolean;
}

export class SavedResourceCardMigrationError extends Error {
  constructor(message: string) {
    super(`Saved resource card migration required: ${message}`);
    this.name = 'SavedResourceCardMigrationError';
  }
}

const asTemplateScalar = (value: unknown, parameterName: string): string => {
  if (
    value === null
    || value === undefined
    || typeof value === 'object'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    throw new SavedResourceCardMigrationError(
      `parameter "${parameterName}" contains a value that cannot be expanded into its URI template.`
    );
  }
  return String(value);
};

/**
 * Converts a saved resource card's URI template and persisted parameters into
 * the concrete URI required by the standard MCP `resources/read` method.
 */
export const getSavedResourceUri = (
  uriTemplate: string,
  params: Record<string, unknown> | null | undefined
): string => {
  const savedParams = params ?? {};

  // Older mcptest versions persisted the already-expanded URI alongside its
  // original arguments. It is complete and must not be expanded a second time.
  if (!UriTemplate.isTemplate(uriTemplate)) {
    return uriTemplate;
  }

  try {
    const template = new UriTemplate(uriTemplate);
    const templateVariables = new Set(template.variableNames);
    const unmappedParameters = Object.keys(savedParams)
      .filter(parameter => !templateVariables.has(parameter));
    if (unmappedParameters.length > 0) {
      throw new SavedResourceCardMigrationError(
        `parameters ${unmappedParameters.map(parameter => `"${parameter}"`).join(', ')} are not present in the saved URI template.`
      );
    }

    const variables: Variables = {};
    for (const [parameterName, value] of Object.entries(savedParams)) {
      variables[parameterName] = Array.isArray(value)
        ? value.map(item => asTemplateScalar(item, parameterName))
        : asTemplateScalar(value, parameterName);
    }
    return template.expand(variables);
  } catch (error) {
    if (error instanceof SavedResourceCardMigrationError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new SavedResourceCardMigrationError(
      `resource "${uriTemplate}" has an invalid URI template: ${reason}`
    );
  }
};

/**
 * Builds the connection inputs for a saved dashboard card. Legacy cards did
 * not persist `useProxy`, so they retain the old proxy-by-default behavior
 * when no target OAuth token is available.
 */
export const getSavedCardConnectionPlan = ({
  serverUrl,
  useProxy,
  oauthToken,
  proxyUrl,
  proxyAuthToken,
}: SavedCardConnectionOptions): SavedCardConnectionPlan => {
  const targetUrl = new URL(serverUrl).toString();
  const usesProxy = Boolean(
    proxyUrl && (useProxy !== undefined ? useProxy : !oauthToken)
  );

  if (!usesProxy) {
    return {
      connectionUrl: targetUrl,
      authToken: oauthToken || undefined,
      usesProxy: false,
    };
  }

  if (!proxyAuthToken) {
    throw new Error('Sign in is required to execute a saved card through the CORS proxy.');
  }

  const connectionUrl = new URL(proxyUrl as string);
  connectionUrl.searchParams.set('target', targetUrl);

  return {
    connectionUrl: connectionUrl.toString(),
    authToken: proxyAuthToken,
    targetHeaders: oauthToken
      ? { Authorization: `Bearer ${oauthToken}` }
      : undefined,
    usesProxy: true,
  };
};
