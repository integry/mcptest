// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '107d9467f0c8361cb91f5328ac63a1558982d013',
  commitDate: '2025-09-05T12:14:37+02:00',
  shortHash: '107d946'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
