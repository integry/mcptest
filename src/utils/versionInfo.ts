// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c4944a8d5d192e29d966907bd28b265041527873',
  commitDate: '2026-07-13T13:53:57Z',
  shortHash: 'c4944a8'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
