// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c59e276148c3efe0a2b8c6284ea2cff2b45800ef',
  commitDate: '2026-11-24T16:48:48+00:00',
  shortHash: 'c59e276'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
