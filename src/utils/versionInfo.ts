// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'fb7eba15ac747e2e2e9e94b364568e948b72b1bb',
  commitDate: '2025-08-25T15:28:02+02:00',
  shortHash: 'fb7eba1'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
