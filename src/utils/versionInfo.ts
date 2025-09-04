// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '86fa0f730a61c4532c1ed65e47f49a93b8b2965a',
  commitDate: '2025-09-04T11:50:18+02:00',
  shortHash: '86fa0f7'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
