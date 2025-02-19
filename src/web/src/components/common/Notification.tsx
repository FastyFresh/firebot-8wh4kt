import React, { useEffect, useCallback, useRef } from 'react';
import styled from '@emotion/styled';
import { AnimatePresence, motion } from 'framer-motion';
import { palette } from '../../config/theme';

// Notification types supported by the component
export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'trade' | 'position' | 'alert';

// Props interface with comprehensive options for trading context
export interface NotificationProps {
  type: NotificationType;
  message: string;
  duration: number;
  onClose: () => void;
  priority: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  sound?: boolean;
  autoFocus?: boolean;
}

// Styled container with trading-optimized dark theme
const NotificationContainer = styled(motion.div)`
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 1500;
  min-width: 320px;
  max-width: 400px;
  padding: 16px;
  border-radius: 8px;
  background-color: ${palette.paper};
  color: ${palette.textPrimary};
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  gap: 12px;

  @media (max-width: 480px) {
    width: calc(100% - 48px);
    max-width: none;
  }
`;

// Icon container with type-specific colors
const IconContainer = styled.div<{ type: NotificationType }>`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: ${({ type }) => getNotificationColor(type)};
`;

// Content wrapper with proper text wrapping
const Content = styled.div`
  flex: 1;
  min-width: 0;
`;

// Message text with trading-optimized typography
const Message = styled.p`
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: ${palette.textPrimary};
`;

// Action button styling
const ActionButton = styled.button`
  background: none;
  border: none;
  padding: 4px 8px;
  margin-top: 8px;
  color: ${palette.primary};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }

  &:focus-visible {
    outline: 2px solid ${palette.primary};
    outline-offset: 2px;
    border-radius: 4px;
  }
`;

// Animation variants for smooth transitions
const variants = {
  initial: { opacity: 0, y: -20, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } }
};

// Helper function to determine notification color based on type
const getNotificationColor = (type: NotificationType): string => {
  switch (type) {
    case 'success':
      return palette.primary;
    case 'error':
      return palette.secondary;
    case 'warning':
      return palette.warning;
    case 'trade':
      return palette.primary;
    case 'position':
      return palette.success;
    case 'alert':
      return palette.error;
    default:
      return palette.primary;
  }
};

// Custom hook for notification sounds
const useNotificationSound = (enabled: boolean, type: NotificationType) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (enabled) {
      const soundMap = {
        success: '/sounds/success.mp3',
        error: '/sounds/error.mp3',
        warning: '/sounds/warning.mp3',
        trade: '/sounds/trade.mp3',
        position: '/sounds/position.mp3',
        alert: '/sounds/alert.mp3',
        info: '/sounds/info.mp3'
      };

      audioRef.current = new Audio(soundMap[type]);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current = null;
      }
    };
  }, [enabled, type]);

  const playSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {
        // Silently handle autoplay restrictions
      });
    }
  }, []);

  return playSound;
};

export const Notification: React.FC<NotificationProps> = ({
  type,
  message,
  duration,
  onClose,
  priority,
  action,
  sound = false,
  autoFocus = false
}) => {
  const notificationRef = useRef<HTMLDivElement>(null);
  const playSound = useNotificationSound(sound, type);

  // Handle auto-dismissal
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  // Handle sound effect
  useEffect(() => {
    if (sound && priority > 0) {
      playSound();
    }
  }, [sound, priority, playSound]);

  // Handle auto-focus for accessibility
  useEffect(() => {
    if (autoFocus && notificationRef.current) {
      notificationRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <AnimatePresence>
      <NotificationContainer
        ref={notificationRef}
        role="alert"
        aria-live={priority > 1 ? 'assertive' : 'polite'}
        tabIndex={autoFocus ? 0 : -1}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        data-testid={`notification-${type}`}
      >
        <IconContainer type={type}>
          {/* Icon component would be added here based on type */}
        </IconContainer>
        <Content>
          <Message>{message}</Message>
          {action && (
            <ActionButton
              onClick={action.onClick}
              aria-label={action.label}
            >
              {action.label}
            </ActionButton>
          )}
        </Content>
      </NotificationContainer>
    </AnimatePresence>
  );
};