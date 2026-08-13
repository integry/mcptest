// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '7b40e2be2e22c2e278b091a4551fd0713f576caa',
  commitDate: '2026-08-12T23:19:56+01:00',
  shortHash: '7b40e2b'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
