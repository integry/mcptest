// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '82cc71e54588663c44d8ddb211a1e1d02a7fb1e3',
  commitDate: '2025-09-05T08:43:05Z',
  shortHash: '82cc71e'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
