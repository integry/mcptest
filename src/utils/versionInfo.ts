// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '156b81135e5f34b2a2499330017e44e0fe3b9d43',
  commitDate: '2025-08-24T01:09:43+03:00',
  shortHash: '156b811'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
