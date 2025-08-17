// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '71f5449590ebcb27d907e64d1ab79ce5364a2ea3',
  commitDate: '2025-08-16T20:02:18+02:00',
  shortHash: '71f5449'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
