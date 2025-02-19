import React, { useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { Portal } from '@mui/material'; // v5.0.0
import { Button } from './Button';
import Loading from './Loading';
import { useTheme } from '../../hooks/useTheme';
import { palette } from '../../config/theme';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
  }>;
  closeOnEsc?: boolean;
  closeOnOutsideClick?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
}

const DialogOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: ${props => props.theme.zIndex?.modal || 1400};
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
`;

const DialogContent = styled.div<{ size?: DialogProps['size'] }>`
  background: ${palette.paper};
  border-radius: 4px;
  padding: 24px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  position: relative;
  color: ${palette.textPrimary};
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  outline: none;
  width: ${({ size }) => {
    switch (size) {
      case 'small':
        return '400px';
      case 'large':
        return '800px';
      default:
        return '600px';
    }
  }};

  &:focus-visible {
    outline: 2px solid ${palette.primary};
    outline-offset: 2px;
  }

  @media (min-width: 1920px) {
    padding: 32px;
    ${({ size }) => size === 'small' && 'width: 480px;'}
    ${({ size }) => size === 'medium' && 'width: 720px;'}
    ${({ size }) => size === 'large' && 'width: 960px;'}
  }
`;

const DialogHeader = styled.div`
  margin-bottom: 24px;
`;

const DialogTitle = styled.h2`
  color: ${palette.textPrimary};
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  line-height: 1.4;

  @media (min-width: 1920px) {
    font-size: 1.5rem;
  }
`;

const DialogBody = styled.div`
  margin-bottom: 24px;
`;

const DialogFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`;

const Dialog: React.FC<DialogProps> = React.memo(({
  isOpen,
  onClose,
  title,
  children,
  size = 'medium',
  loading = false,
  actions = [],
  closeOnEsc = true,
  closeOnOutsideClick = true,
  initialFocusRef
}) => {
  const { isDarkMode } = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Handle ESC key press
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && closeOnEsc) {
      onClose();
    }
  }, [closeOnEsc, onClose]);

  // Handle click outside
  const handleOutsideClick = useCallback((event: MouseEvent) => {
    if (
      closeOnOutsideClick &&
      dialogRef.current &&
      !dialogRef.current.contains(event.target as Node)
    ) {
      onClose();
    }
  }, [closeOnOutsideClick, onClose]);

  // Manage focus and keyboard events
  useEffect(() => {
    if (isOpen) {
      // Store current focus
      previousFocus.current = document.activeElement as HTMLElement;
      
      // Set initial focus
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (dialogRef.current) {
        dialogRef.current.focus();
      }

      // Add event listeners
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('mousedown', handleOutsideClick);
      
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    }

    return () => {
      if (isOpen) {
        // Remove event listeners
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('mousedown', handleOutsideClick);
        
        // Restore body scroll
        document.body.style.overflow = '';
        
        // Restore focus
        previousFocus.current?.focus();
      }
    };
  }, [isOpen, handleKeyDown, handleOutsideClick, initialFocusRef]);

  if (!isOpen) return null;

  return (
    <Portal>
      <DialogOverlay>
        <DialogContent
          ref={dialogRef}
          size={size}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          tabIndex={-1}
          data-theme={isDarkMode ? 'dark' : 'light'}
        >
          <DialogHeader>
            <DialogTitle id="dialog-title">{title}</DialogTitle>
          </DialogHeader>
          
          <DialogBody>
            {loading ? (
              <Loading 
                size="lg"
                overlay
                text="Please wait..."
                reducedMotion={false}
              />
            ) : (
              children
            )}
          </DialogBody>

          {actions.length > 0 && (
            <DialogFooter>
              {actions.map((action, index) => (
                <Button
                  key={`dialog-action-${index}`}
                  onClick={action.onClick}
                  variant={action.variant || 'primary'}
                  disabled={action.disabled || loading}
                  size="medium"
                  aria-label={action.label}
                >
                  {action.label}
                </Button>
              ))}
            </DialogFooter>
          )}
        </DialogContent>
      </DialogOverlay>
    </Portal>
  );
});

Dialog.displayName = 'Dialog';

export default Dialog;