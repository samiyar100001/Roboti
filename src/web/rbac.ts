import type { AccessRole } from '../db/database';

export type AdminPermission =
  | 'VIEW_DASHBOARD_TELEMETRY'
  | 'VIEW_AUDIT_LOGS'
  | 'VIEW_REQUESTS_AND_QUARANTINE'
  | 'UNMASK_PII'
  | 'MANAGE_USERS_AND_CREDITS'
  | 'MANAGE_QUEUE_STATE'
  | 'MANAGE_CONFIG_STUDIO'
  | 'MANAGE_MTPROTO_SESSIONS'
  | 'RUN_OPERATIONAL_SIMULATOR';

const ROLE_PERMISSION_MATRIX: Record<AccessRole, readonly AdminPermission[]> = {
  USER: [],
  AUDITOR: [
    'VIEW_DASHBOARD_TELEMETRY',
    'VIEW_AUDIT_LOGS',
    'VIEW_REQUESTS_AND_QUARANTINE',
  ],
  SUPPORT_ADMIN: [
    'VIEW_DASHBOARD_TELEMETRY',
    'VIEW_REQUESTS_AND_QUARANTINE',
    'RUN_OPERATIONAL_SIMULATOR',
  ],
  FINANCE_ADMIN: [
    'VIEW_DASHBOARD_TELEMETRY',
    'VIEW_AUDIT_LOGS',
    'MANAGE_USERS_AND_CREDITS',
  ],
  OPS_ADMIN: [
    'VIEW_DASHBOARD_TELEMETRY',
    'VIEW_AUDIT_LOGS',
    'VIEW_REQUESTS_AND_QUARANTINE',
    'MANAGE_QUEUE_STATE',
    'MANAGE_CONFIG_STUDIO',
    'RUN_OPERATIONAL_SIMULATOR',
  ],
  SUPER_ADMIN: [
    'VIEW_DASHBOARD_TELEMETRY',
    'VIEW_AUDIT_LOGS',
    'VIEW_REQUESTS_AND_QUARANTINE',
    'UNMASK_PII',
    'MANAGE_USERS_AND_CREDITS',
    'MANAGE_QUEUE_STATE',
    'MANAGE_CONFIG_STUDIO',
    'MANAGE_MTPROTO_SESSIONS',
    'RUN_OPERATIONAL_SIMULATOR',
  ],
  OWNER: [
    'VIEW_DASHBOARD_TELEMETRY',
    'VIEW_AUDIT_LOGS',
    'VIEW_REQUESTS_AND_QUARANTINE',
    'UNMASK_PII',
    'MANAGE_USERS_AND_CREDITS',
    'MANAGE_QUEUE_STATE',
    'MANAGE_CONFIG_STUDIO',
    'MANAGE_MTPROTO_SESSIONS',
    'RUN_OPERATIONAL_SIMULATOR',
  ],
};

export function hasAdminPermission(role: AccessRole, permission: AdminPermission): boolean {
  const allowed = ROLE_PERMISSION_MATRIX[role] ?? [];
  return allowed.includes(permission);
}

export function isAdministrativeRole(role: AccessRole): boolean {
  return role !== 'USER';
}

export function listRolePermissions(role: AccessRole): readonly AdminPermission[] {
  return ROLE_PERMISSION_MATRIX[role] ?? [];
}
