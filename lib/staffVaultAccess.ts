/**
 * Staff/leadership may open Vault separately — never embed Vault admin UI in Connect.
 * Role list mirrors Vault operational roles (not ordinary MEMBER / PARENT / YOUTH).
 */

export const VAULT_PUBLIC_ORIGIN = 'https://plcc-opal.vercel.app';

const VAULT_STAFF_ROLES = new Set([
  'SUPER_ADMIN',
  'PASTOR',
  'MINISTRY_LEADER',
  'FINANCE',
  'MEDIA_TEAM',
  'ADMIN_STAFF',
  'STAFF',
  'SECRETARY',
  'ASST_SECRETARY',
  'FIRST_LADY',
  'ADMIN',
]);

export function canOpenVaultStaffLink(role: string | null | undefined): boolean {
  if (!role) return false;
  return VAULT_STAFF_ROLES.has(String(role).trim().toUpperCase());
}
