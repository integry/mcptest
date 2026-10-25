// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '2bb67459544d280f3448f7466db57db3d9f3e8c6',
  commitDate: '2026-10-25T03:34:33+03:00',
  shortHash: '2bb6745'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
