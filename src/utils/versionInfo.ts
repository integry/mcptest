// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '4655d0a3eb2219f8112d338197539e3bc598fae1',
  commitDate: '2025-09-05T11:46:19+03:00',
  shortHash: '4655d0a'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
