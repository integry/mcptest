// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c264c5913b4267fb732b1c5f3defa4a161e39495',
  commitDate: '2026-10-20T11:10:00+03:00',
  shortHash: 'c264c59'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
