import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * Dropdown behind the game-list filter bar.
 *
 * The reference builds these as a button plus a popover listbox rather than a
 * native `<select>` — it wants the truncating value, the rotating chevron and
 * a menu it can style — so this does too, which means taking on the keyboard
 * contract a native select would have given us for free: Arrow/Home/End move
 * the active option, Enter or Space commits it, Escape closes and hands focus
 * back to the button, and a click anywhere outside dismisses.
 *
 * Two variants, both lifted from the reference's own two controls:
 *
 * `filled`  — the Categories / Providers filter. Sits on `goku` with a 1px
 *             inset ring, and shows `placeholder` in `trunks` until a real
 *             option is picked.
 * `outline` — the Sort control. Transparent, same ring, and a paired-chevron
 *             glyph instead of a caret because it reorders rather than filters.
 *
 * `options` is `[{ value, label }]`; `value` is the currently selected
 * `option.value`, and `onChange` receives the newly selected one.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  variant = 'filled',
  placeholder,
  className,
  ...props
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const id = useId();

  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);

  // Dismiss on an outside press. `mousedown` rather than `click`, so the menu
  // is gone before the press lands on whatever is underneath it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Focus moves to the list itself and options are tracked with
  // `aria-activedescendant`, so arrow keys never fight the browser's own
  // focus order and the button keeps its place in the tab sequence.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const openWith = (index) => {
    setActive(index < 0 ? 0 : index);
    setOpen(true);
  };

  const commit = (option) => {
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openWith(selectedIndex);
    }
  };

  const onListKeyDown = (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(options[active]);
        break;
      case 'Escape':
      case 'Tab':
        setOpen(false);
        buttonRef.current?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)} {...props}>
      <span id={`${id}-label`} className="mb-1 block text-sm leading-5 text-trunks">
        {label}
      </span>

      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : openWith(selectedIndex))}
        onKeyDown={onButtonKeyDown}
        className={cn(
          'flex h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-i-sm px-4 text-sm',
          'ring-1 ring-inset ring-beerus transition-shadow hover:ring-bulma',
          variant === 'filled' ? 'bg-goku' : 'bg-transparent md:min-w-[11.25rem]',
        )}
      >
        <span
          id={`${id}-value`}
          className={cn('truncate text-start', value ? 'text-bulma' : 'text-trunks')}
        >
          {selected ? selected.label : placeholder}
        </span>
        {variant === 'filled' ? (
          <Icon
            name="chevron-down"
            size={20}
            className={cn('shrink-0 text-trunks transition-transform', open && 'rotate-180')}
          />
        ) : (
          <Icon name="sort" size={20} className="shrink-0 text-trunks" />
        )}
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={onListKeyDown}
          className={cn(
            'absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-i-sm bg-goku p-1',
            'shadow-lg ring-1 ring-beerus focus:outline-none',
          )}
        >
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => commit(option)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-i-xs px-3 py-2 text-sm',
                i === active ? 'bg-heles text-bulma' : 'text-trunks',
                option.value === value && 'font-medium text-bulma',
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && (
                <Icon name="check" size={16} className="shrink-0 text-piccolo" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
