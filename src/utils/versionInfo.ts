// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'd89beef3d60055e49888f5b2296f3029be803321',
  commitDate: '2025-09-05T15:24:04+02:00',
  shortHash: 'd89beef'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
