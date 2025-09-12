// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '835da1cfed00043b2401432db09f35a7bd9a0562',
  commitDate: '2025-09-08T08:34:22+02:00',
  shortHash: '835da1c'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
