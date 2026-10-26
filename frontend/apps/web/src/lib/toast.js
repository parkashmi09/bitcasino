/**
 * Toasts: a tiny store the `<Toaster />` renders (components/ui/Toaster.jsx).
 * Callable from anywhere, React or not — the query client's MutationCache
 * raises them for `meta.success` (queries/client.js).
 *
 *   toast.success('Swap complete')
 *   toast.error('Could not reach the server', { title: 'Network' })
 *
 * Field errors stay inline under their field, as on the reference site; a toast
 * is for "it worked" and for failures no field owns.
 */

const listeners = new Set();
let items = [];
let seq = 0;

/** At most this many on screen; the oldest goes first. */
const MAX = 3;
const DURATION_MS = { success: 4000, info: 5000, warning: 6000, error: 7000 };

function emit() {
  for (const fn of listeners) fn(items);
}

export function dismissToast(id) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(tone, message, { title, duration } = {}) {
  if (!message) return null;
  const id = ++seq;
  items = [...items, { id, tone, title, message: String(message) }].slice(-MAX);
  emit();
  setTimeout(() => dismissToast(id), duration ?? DURATION_MS[tone]);
  return id;
}

export const toast = {
  success: (message, opts) => push('success', message, opts),
  info: (message, opts) => push('info', message, opts),
  warning: (message, opts) => push('warning', message, opts),
  error: (message, opts) => push('error', message, opts),
};

export function subscribeToasts(fn) {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}

/** Tests only. */
export function resetToasts() {
  items = [];
  emit();
}
