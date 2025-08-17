import React from 'react';

interface NotificationPopupProps {
  message: string;
  show: boolean;
}

const NotificationPopup: React.FC<NotificationPopupProps> = ({ message, show }) => {
  if (!show) {
    return null;
  }

  return (
    <div className="notification-popup" aria-live="polite">
      {message}
    </div>
  );
};

export default NotificationPopup;
