import { useState, useCallback } from 'react';

type ShareStatus = 'idle' | 'success' | 'error';

export const useShare = () => {
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const [shareMessage, setShareMessage] = useState('');

  const share = useCallback(async (shareData: { url: string; title: string; text: string }) => {
    if (navigator.share) {
      // Use Web Share API on mobile
      try {
        await navigator.share(shareData);
        setShareStatus('success');
        setShareMessage('Shared successfully!');
      } catch (error) {
        console.error('Error sharing:', error);
        setShareStatus('error');
        setShareMessage('Could not share');
      }
    } else {
      // Fallback to clipboard on desktop
      try {
        await navigator.clipboard.writeText(shareData.url);
        setShareStatus('success');
        setShareMessage('Share link copied to clipboard');
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        setShareStatus('error');
        setShareMessage('Failed to copy');
      }
    }

    // Reset status after a delay
    setTimeout(() => {
      setShareStatus('idle');
      setShareMessage('');
    }, 3000);
  }, []);

  return { share, shareStatus, shareMessage };
};