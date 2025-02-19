import React, { useState, useRef, useCallback } from 'react';
import styled from '@emotion/styled';
import { darkTheme } from '../../config/theme';

// Interfaces
interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
}

interface DropdownProps {
  value: string | string[];
  options: DropdownOption[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  multiSelect?: boolean;
  width?: string;
  error?: string;
  label?: string;
  id?: string;
  ariaLabel?: string;
}

// Styled Components
const DropdownContainer = styled.div<{
  width?: string;
  disabled?: boolean;
  hasError?: boolean;
  isOpen?: boolean;
}>`
  width: ${({ width }) => width || '100%'};
  position: relative;
  font-family: ${darkTheme.typography.fontFamily};
  background: ${darkTheme.palette.paper};
  border: ${darkTheme.shape.borderWidth}px solid ${({ hasError }) => 
    hasError ? darkTheme.palette.secondary : darkTheme.palette.border};
  border-radius: ${darkTheme.shape.borderRadius}px;
  opacity: ${({ disabled }) => (disabled ? 0.5 : 1)};
  pointer-events: ${({ disabled }) => (disabled ? 'none' : 'auto')};
  transition: all ${darkTheme.transitions.duration.standard}ms ease;

  &:hover:not(:disabled) {
    border-color: ${({ hasError }) =>
      hasError ? darkTheme.palette.secondary : darkTheme.palette.primary};
  }

  &:focus-within {
    outline: none;
    border-color: ${darkTheme.palette.primary};
    box-shadow: ${darkTheme.shadows.sm};
  }
`;

const DropdownHeader = styled.button`
  width: 100%;
  padding: ${darkTheme.spacing.sm}px ${darkTheme.spacing.md}px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: transparent;
  border: none;
  color: ${darkTheme.palette.textPrimary};
  cursor: pointer;
  font-size: ${darkTheme.typography.fontSize.base};
  text-align: left;

  &:focus {
    outline: none;
  }
`;

const OptionsList = styled.ul<{ isOpen: boolean }>`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin: ${darkTheme.spacing.xs}px 0 0;
  padding: ${darkTheme.spacing.xs}px 0;
  background: ${darkTheme.palette.paper};
  border: ${darkTheme.shape.borderWidth}px solid ${darkTheme.palette.border};
  border-radius: ${darkTheme.shape.borderRadius}px;
  box-shadow: ${darkTheme.shadows.md};
  z-index: ${darkTheme.zIndex.dropdown};
  display: ${({ isOpen }) => (isOpen ? 'block' : 'none')};
  max-height: 300px;
  overflow-y: auto;
`;

const Option = styled.li<{ isSelected: boolean; isDisabled: boolean }>`
  padding: ${darkTheme.spacing.sm}px ${darkTheme.spacing.md}px;
  color: ${({ isDisabled }) =>
    isDisabled ? darkTheme.palette.textSecondary : darkTheme.palette.textPrimary};
  background: ${({ isSelected }) =>
    isSelected ? `${darkTheme.palette.primary}20` : 'transparent'};
  cursor: ${({ isDisabled }) => (isDisabled ? 'not-allowed' : 'pointer')};
  display: flex;
  align-items: center;
  
  &:hover:not(:disabled) {
    background: ${({ isSelected }) =>
      isSelected ? `${darkTheme.palette.primary}30` : `${darkTheme.palette.primary}10`};
  }
`;

const Label = styled.label`
  display: block;
  margin-bottom: ${darkTheme.spacing.xs}px;
  color: ${darkTheme.palette.textSecondary};
  font-size: ${darkTheme.typography.fontSize.sm};
`;

const Error = styled.span`
  color: ${darkTheme.palette.secondary};
  font-size: ${darkTheme.typography.fontSize.sm};
  margin-top: ${darkTheme.spacing.xs}px;
  display: block;
`;

// Main Component
export const Dropdown: React.FC<DropdownProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select option',
  disabled = false,
  multiSelect = false,
  width,
  error,
  label,
  id,
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const lastIndex = options.length - 1;
        let newIndex = activeIndex + direction;

        if (newIndex < 0) newIndex = lastIndex;
        if (newIndex > lastIndex) newIndex = 0;

        while (options[newIndex].disabled && newIndex !== activeIndex) {
          newIndex = newIndex + direction;
          if (newIndex < 0) newIndex = lastIndex;
          if (newIndex > lastIndex) newIndex = 0;
        }

        setActiveIndex(newIndex);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (isOpen && activeIndex >= 0) {
          handleOptionSelect(options[activeIndex].value);
        } else {
          setIsOpen(true);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        setIsOpen(false);
        break;
      }
      case 'Tab': {
        if (isOpen) {
          event.preventDefault();
          setIsOpen(false);
        }
        break;
      }
    }
  }, [activeIndex, isOpen, options, disabled]);

  const handleOptionSelect = useCallback((optionValue: string) => {
    const option = options.find(opt => opt.value === optionValue);
    if (option?.disabled) return;

    if (multiSelect) {
      const values = Array.isArray(value) ? value : [];
      const newValue = values.includes(optionValue)
        ? values.filter(v => v !== optionValue)
        : [...values, optionValue];
      onChange(newValue);
    } else {
      onChange(optionValue);
      setIsOpen(false);
    }
  }, [multiSelect, value, onChange, options]);

  const getDisplayValue = () => {
    if (Array.isArray(value)) {
      return value
        .map(v => options.find(opt => opt.value === v)?.label)
        .filter(Boolean)
        .join(', ') || placeholder;
    }
    return options.find(opt => opt.value === value)?.label || placeholder;
  };

  const dropdownId = id || 'dropdown';
  const listId = `${dropdownId}-list`;

  return (
    <DropdownContainer
      ref={containerRef}
      width={width}
      disabled={disabled}
      hasError={!!error}
      isOpen={isOpen}
    >
      {label && <Label htmlFor={dropdownId}>{label}</Label>}
      
      <DropdownHeader
        id={dropdownId}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={label ? undefined : dropdownId}
        aria-label={ariaLabel || label}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${dropdownId}-option-${activeIndex}` : undefined}
        role="combobox"
      >
        {getDisplayValue()}
      </DropdownHeader>

      <OptionsList
        ref={listRef}
        id={listId}
        isOpen={isOpen}
        role="listbox"
        aria-multiselectable={multiSelect}
      >
        {options.map((option, index) => (
          <Option
            key={option.value}
            id={`${dropdownId}-option-${index}`}
            role="option"
            aria-selected={Array.isArray(value) ? value.includes(option.value) : value === option.value}
            aria-disabled={option.disabled}
            isSelected={Array.isArray(value) ? value.includes(option.value) : value === option.value}
            isDisabled={!!option.disabled}
            onClick={() => handleOptionSelect(option.value)}
            title={option.description}
          >
            {option.label}
          </Option>
        ))}
      </OptionsList>

      {error && <Error role="alert">{error}</Error>}
    </DropdownContainer>
  );
};