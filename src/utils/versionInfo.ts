// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'e64f90a90c7514d45825761edb2b92d90af716cd',
  commitDate: '2025-08-05T14:17:21+03:00',
  shortHash: 'e64f90a'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
