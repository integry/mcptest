// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '3f932c0cf5480f0e99a6a5a073ab9534df133e59',
  commitDate: '2026-10-20T15:05:33+00:00',
  shortHash: '3f932c0'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
