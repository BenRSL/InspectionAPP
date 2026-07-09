// Shared types only — no client-creation code here. This file has zero imports,
// so it's always safe for both server and client components to use.

export type UserRole = 'god' | 'admin' | 'inspector';

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  assigned_sites: string[];
}
