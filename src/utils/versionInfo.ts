// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '803f9f9db54502b8bca1c9de109fa0f52d8fc193',
  commitDate: '2025-08-28T17:36:56+02:00',
  shortHash: '803f9f9'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
