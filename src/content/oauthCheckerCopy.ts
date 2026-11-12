/** Shared first-screen copy; the build prerenders the React component itself. */
export const OAUTH_CHECKER_COPY = {
  heading: 'MCP OAuth checker',
  lede: 'Check each OAuth discovery step an MCP client runs before login: the unauthenticated MCP challenge, protected resource metadata, authorization server metadata, resource URL match, client registration options, PKCE and the authorization code flow. Each step shows its evidence and what to fix.',
  hint: 'Free and read-only: the checker sends no credentials, stores nothing, registers no client and does not log in. The unauthenticated MCP request is sent from your browser; metadata that CORS blocks is read through the restricted discovery proxy.',
};
