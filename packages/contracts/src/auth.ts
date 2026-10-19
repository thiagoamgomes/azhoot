import { z } from 'zod';
import { USER_ROLES, type UserRole } from './constants';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Informe um e-mail válido.').max(254));

export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa ter pelo menos 10 caracteres.')
  .max(128, 'A senha pode ter no máximo 128 caracteres.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const userRoleSchema = z.enum(USER_ROLES);

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['ADMIN', 'PRESENTER']),
  canViewAllReports: z.boolean().default(false),
});
export type UserCreateInput = z.input<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['ADMIN', 'PRESENTER']).optional(),
  active: z.boolean().optional(),
  canViewAllReports: z.boolean().optional(),
  password: passwordSchema.optional(),
});
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  canViewAllReports: boolean;
  isMaster: boolean;
  accountId: string;
  /** Exige troca de senha antes de continuar (ex.: após reset pelo master). */
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: AuthUser;
  csrfToken: string;
}

export const PERMISSIONS = {
  manageUsers: ['OWNER'],
  manageSettings: ['OWNER'],
  editQuizzes: ['OWNER', 'ADMIN'],
  presentQuizzes: ['OWNER', 'ADMIN', 'PRESENTER'],
} as const satisfies Record<string, readonly UserRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}
