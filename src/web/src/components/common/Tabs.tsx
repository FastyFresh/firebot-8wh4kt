import React, { useCallback, useRef, useState } from 'react';
import '../../styles/components.css';

/**
 * Props interface for the Tabs component following WCAG 2.1 Level AA standards
 */
export interface TabsProps {
  /** Array of tab labels */
  tabs: string[];
  /** Currently active tab index */
  activeTab: number;
  /** Callback function when tab changes */
  onChange: (index: number) => void;
  /** Optional CSS class name */
  className?: string;
  /** Accessible label for the tablist */
  ariaLabel?: string;
}

/**
 * Accessible Tabs component optimized for dark theme trading interfaces
 * Implements WCAG 2.1 Level AA standards with enhanced keyboard navigation
 */
export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className = '',
  ariaLabel = 'Navigation Tabs'
}) => {
  const [focusedTab, setFocusedTab] = useState<number>(activeTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Handles tab selection with accessibility support
   */
  const handleTabChange = useCallback((index: number, event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.preventDefault();
    
    if (index >= 0 && index < tabs.length) {
      onChange(index);
      setFocusedTab(index);
      tabRefs.current[index]?.focus();
    }
  }, [onChange, tabs.length]);

  /**
   * Manages keyboard navigation following WCAG guidelines
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    let newIndex = focusedTab;

    switch (event.key) {
      case 'ArrowLeft':
        newIndex = focusedTab > 0 ? focusedTab - 1 : tabs.length - 1;
        break;
      case 'ArrowRight':
        newIndex = focusedTab < tabs.length - 1 ? focusedTab + 1 : 0;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'End':
        newIndex = tabs.length - 1;
        break;
      case 'Enter':
      case ' ':
        handleTabChange(focusedTab, event);
        return;
      default:
        return;
    }

    event.preventDefault();
    setFocusedTab(newIndex);
    tabRefs.current[newIndex]?.focus();
  }, [focusedTab, handleTabChange, tabs.length]);

  return (
    <div
      className={`tabs-container ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab}
          ref={el => tabRefs.current[index] = el}
          role="tab"
          aria-selected={index === activeTab}
          aria-controls={`panel-${index}`}
          id={`tab-${index}`}
          tabIndex={index === activeTab ? 0 : -1}
          className={`tab ${index === activeTab ? 'tab-active' : ''} ${
            index === focusedTab ? 'tab-focus' : ''
          }`}
          onClick={(e) => handleTabChange(index, e)}
          onKeyDown={handleKeyDown}
        >
          {tab}
          {/* Screen reader only indicator for selected state */}
          {index === activeTab && (
            <span className="sr-only">(Selected)</span>
          )}
        </button>
      ))}
      <style jsx>{`
        .tabs-container {
          display: flex;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--background-color);
          margin-bottom: var(--spacing-lg);
          position: relative;
          outline: none;
        }

        .tab {
          padding: var(--spacing-md) var(--spacing-lg);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
          border: none;
          background: none;
          border-bottom: 2px solid transparent;
          font-family: var(--font-family);
          font-size: var(--font-size-md);
          user-select: none;
        }

        .tab:hover:not(.tab-active) {
          color: var(--text-primary);
          background-color: var(--hover-overlay);
        }

        .tab-active {
          color: var(--text-primary);
          border-bottom: 2px solid var(--primary-color);
        }

        .tab-focus {
          outline: 2px solid var(--primary-color);
          outline-offset: -2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .tab {
            transition: none;
          }
        }

        @media screen and (min-width: 1920px) {
          .tab {
            padding: var(--spacing-lg) var(--spacing-xl);
            font-size: var(--font-size-lg);
          }
        }
      `}</style>
    </div>
  );
};