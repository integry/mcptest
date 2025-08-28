// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '931d72b29989d62974a8a094a608b475ac986d1c',
  commitDate: '2025-08-28T17:04:43+02:00',
  shortHash: '931d72b'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
