/**
 * Design kit — buttons. One look for every tap target in Connect.
 *
 *   primary   burgundy fill — the one main action on a screen
 *   secondary burgundy outline — the alternative action
 *   subtle    soft gray — retry, cancel, low-stakes actions
 *   ghost     text only — inline links that behave like buttons
 *   danger    red fill — destructive actions
 *   dark      ink fill — on light imagery
 *
 * Sizes: sm 40px, md 48px (default), lg 56px. All meet the 44px tap target
 * except `sm`, which is for dense rows that already have 44px row height.
 */
import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';

type StyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-[transform,background-color,color] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 select-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-burgundy text-white hover:bg-burgundy-dark shadow-sm',
  secondary: 'bg-white text-burgundy border border-burgundy/25 hover:bg-burgundy/5',
  subtle: 'bg-gray-100 text-ink hover:bg-gray-200',
  ghost: 'bg-transparent text-burgundy hover:bg-burgundy/5',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  dark: 'bg-ink text-white hover:bg-black',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-3.5 text-sm',
  md: 'min-h-[48px] px-5 text-sm',
  lg: 'min-h-[56px] px-6 text-base',
};

export function buttonClass({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: StyleProps = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth ? 'w-full' : '', className]
    .filter(Boolean)
    .join(' ');
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & StyleProps;

export const Button: React.FC<ButtonProps> = ({
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  children,
  ...props
}) => (
  <button type={type} className={buttonClass({ variant, size, fullWidth, className })} {...props}>
    {children}
  </button>
);

/** In-app navigation styled as a button. */
export const ButtonLink: React.FC<LinkProps & StyleProps> = ({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...props
}) => (
  <Link className={buttonClass({ variant, size, fullWidth, className })} {...props}>
    {children}
  </Link>
);

/** External link styled as a button (opens in a new tab). */
export const ButtonAnchor: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & StyleProps> = ({
  variant,
  size,
  fullWidth,
  className,
  children,
  target = '_blank',
  rel = 'noopener noreferrer',
  ...props
}) => (
  <a
    target={target}
    rel={rel}
    className={buttonClass({ variant, size, fullWidth, className })}
    {...props}
  >
    {children}
  </a>
);
