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

interface UriTemplateOperator {
  prefix: string;
  separator: string;
  named: boolean;
  emptyValue: string;
  allowReserved: boolean;
}

interface UriTemplateVariable {
  name: string;
  explode: boolean;
  prefixLength?: number;
}

const URI_TEMPLATE_OPERATORS: Record<string, UriTemplateOperator> = {
  '': { prefix: '', separator: ',', named: false, emptyValue: '', allowReserved: false },
  '+': { prefix: '', separator: ',', named: false, emptyValue: '', allowReserved: true },
  '#': { prefix: '#', separator: ',', named: false, emptyValue: '', allowReserved: true },
  '.': { prefix: '.', separator: '.', named: false, emptyValue: '', allowReserved: false },
  '/': { prefix: '/', separator: '/', named: false, emptyValue: '', allowReserved: false },
  ';': { prefix: ';', separator: ';', named: true, emptyValue: '', allowReserved: false },
  '?': { prefix: '?', separator: '&', named: true, emptyValue: '=', allowReserved: false },
  '&': { prefix: '&', separator: '&', named: true, emptyValue: '=', allowReserved: false },
};

export class SavedResourceCardMigrationError extends Error {
  constructor(message: string) {
    super(`Saved resource card migration required: ${message}`);
    this.name = 'SavedResourceCardMigrationError';
  }
}

const parseTemplateExpression = (expression: string): {
  operator: UriTemplateOperator;
  variables: UriTemplateVariable[];
} => {
  const operatorKey = Object.prototype.hasOwnProperty.call(
    URI_TEMPLATE_OPERATORS,
    expression[0]
  )
    ? expression[0]
    : '';
  const variableList = operatorKey ? expression.slice(1) : expression;
  if (!variableList) {
    throw new SavedResourceCardMigrationError('the saved URI template is invalid.');
  }

  const variables = variableList.split(',').map(variable => {
    const match = /^([A-Za-z0-9_.%]+)(?::([1-9][0-9]{0,3})|(\*))?$/.exec(variable);
    if (!match) {
      throw new SavedResourceCardMigrationError(
        `the URI template variable "${variable}" is not supported.`
      );
    }
    return {
      name: match[1],
      explode: Boolean(match[3]),
      prefixLength: match[2] ? Number(match[2]) : undefined,
    };
  });

  return { operator: URI_TEMPLATE_OPERATORS[operatorKey], variables };
};

const encodeTemplateValue = (value: string, allowReserved: boolean): string => {
  const encodeCharacter = (character: string) => encodeURIComponent(character)
    .replace(/[!'()*]/g, match => `%${match.charCodeAt(0).toString(16).toUpperCase()}`);
  const reservedCharacter = /[:/?#\[\]@!$&'()*+,;=]/;

  return Array.from(value)
    .map(character => allowReserved && reservedCharacter.test(character)
      ? character
      : encodeCharacter(character))
    .join('');
};

const asScalar = (value: unknown, parameterName: string): string => {
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new SavedResourceCardMigrationError(
      `parameter "${parameterName}" contains a value that cannot be expanded into its URI template.`
    );
  }
  return String(value);
};

const formatNamedValue = (
  name: string,
  value: string,
  operator: UriTemplateOperator
): string => `${name}${value === '' ? operator.emptyValue : `=${value}`}`;

const expandTemplateVariable = (
  variable: UriTemplateVariable,
  value: unknown,
  operator: UriTemplateOperator
): string => {
  const encodedName = encodeTemplateValue(variable.name, false);
  const encode = (item: unknown) => encodeTemplateValue(
    asScalar(item, variable.name),
    operator.allowReserved
  );

  if (!Array.isArray(value) && (typeof value !== 'object' || value === null)) {
    let scalar = asScalar(value, variable.name);
    if (variable.prefixLength !== undefined) {
      scalar = Array.from(scalar).slice(0, variable.prefixLength).join('');
    }
    const encodedValue = encodeTemplateValue(scalar, operator.allowReserved);
    return operator.named
      ? formatNamedValue(encodedName, encodedValue, operator)
      : encodedValue;
  }

  if (variable.prefixLength !== undefined) {
    throw new SavedResourceCardMigrationError(
      `parameter "${variable.name}" uses a URI prefix modifier with a composite value.`
    );
  }

  if (Array.isArray(value)) {
    const encodedItems = value.map(encode);
    if (variable.explode) {
      return encodedItems
        .map(item => operator.named ? formatNamedValue(encodedName, item, operator) : item)
        .join(operator.separator);
    }
    const joinedItems = encodedItems.join(',');
    return operator.named
      ? formatNamedValue(encodedName, joinedItems, operator)
      : joinedItems;
  }

  const encodedEntries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    encodeTemplateValue(key, operator.allowReserved),
    encode(item),
  ]);
  if (variable.explode) {
    return encodedEntries
      .map(([key, item]) => formatNamedValue(key, item, operator))
      .join(operator.separator);
  }
  const joinedEntries = encodedEntries.flat().join(',');
  return operator.named
    ? formatNamedValue(encodedName, joinedEntries, operator)
    : joinedEntries;
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
  const expressionPattern = /\{([^{}]+)\}/g;
  const expressions = Array.from(uriTemplate.matchAll(expressionPattern));

  if (expressions.length === 0) {
    if (Object.keys(savedParams).length > 0) {
      throw new SavedResourceCardMigrationError(
        `resource "${uriTemplate}" has saved parameters but is not a URI template. Recreate the card from a resource template.`
      );
    }
    return uriTemplate;
  }

  const parsedExpressions = expressions.map(match => parseTemplateExpression(match[1]));
  const templateVariables = new Set(
    parsedExpressions.flatMap(({ variables }) => variables.map(({ name }) => name))
  );
  const unmappedParameters = Object.keys(savedParams)
    .filter(parameter => !templateVariables.has(parameter));
  if (unmappedParameters.length > 0) {
    throw new SavedResourceCardMigrationError(
      `parameters ${unmappedParameters.map(parameter => `"${parameter}"`).join(', ')} are not present in the saved URI template.`
    );
  }

  let expressionIndex = 0;
  const expandedUri = uriTemplate.replace(expressionPattern, () => {
    const { operator, variables } = parsedExpressions[expressionIndex++];
    const values = variables.flatMap(variable => {
      if (!Object.prototype.hasOwnProperty.call(savedParams, variable.name)) return [];
      const value = savedParams[variable.name];
      if (value === null || value === undefined) {
        throw new SavedResourceCardMigrationError(
          `parameter "${variable.name}" has no value to expand into the URI template.`
        );
      }
      return [expandTemplateVariable(variable, value, operator)];
    });
    return values.length > 0 ? operator.prefix + values.join(operator.separator) : '';
  });

  if (/[{}]/.test(expandedUri)) {
    throw new SavedResourceCardMigrationError('the saved URI template is invalid.');
  }
  return expandedUri;
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
