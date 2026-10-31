/**
 * Sports Exchange — Account screens (zip msadmin) ki common cheezein.
 * Backend: admin-service module `exchange-accounts` (basePath `/exchange/accounts-admin`).
 */

export const ACCOUNTS_API = 'admin/exchange/accounts-admin'

/** Zip ka password rule (Create Account aur Multi Login dono me). */
export const passwordError = (value: string) => {
  if (!value) return 'The Password field is required'
  if (value.length < 8) return 'The Password field must be at least 8 characters'
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value)) return 'The password must contain at least: 1 uppercase letter, 1 lowercase letter, 1 number'

  return ''
}
