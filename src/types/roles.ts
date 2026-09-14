// Central place to define the two roles the system knows about.
// Add new roles here and everything else (middleware, JWT payload) picks them up.

export type Role = "admin" | "super_admin";

export const ROLES: Record<string, Role> = {
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
};