// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '6a3f7a91acaf91dfa21432fb9a5b7ec94a07f2a5',
  commitDate: '2026-10-20T05:07:19+03:00',
  shortHash: '6a3f7a9'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
