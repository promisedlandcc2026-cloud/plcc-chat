/**
 * Design kit — form fields. One look for text inputs across Connect:
 * 52px tall (48px compact), 16px text (no iOS zoom-on-focus), visible focus ring.
 */
export function inputClass({
  size = 'md',
  className = '',
}: { size?: 'md' | 'sm'; className?: string } = {}): string {
  return [
    'w-full rounded-2xl border border-gray-200 bg-eggshell text-ink text-base',
    'placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-burgundy/30 focus:border-burgundy',
    size === 'sm' ? 'min-h-[48px]' : 'min-h-[52px]',
    className || 'px-4',
  ].join(' ');
}

/** Field label: readable 14px semibold (no tiny caps). */
export const LABEL_CLASS = 'block text-sm font-semibold text-ink-muted';
