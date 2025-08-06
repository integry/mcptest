// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'ec671d369e7382ea5193adfef5029bc083782d6c',
  commitDate: '2025-08-06T14:09:24+02:00',
  shortHash: 'ec671d3'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
