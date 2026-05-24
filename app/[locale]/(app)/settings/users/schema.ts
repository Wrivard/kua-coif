import { z } from 'zod';
import { SHOP_MEMBER_STATUSES, USER_ROLES } from '@/db/enums';

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(USER_ROLES),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateMemberSchema = z.object({
  member_id: z.string().uuid(),
  role: z.enum(USER_ROLES),
  status: z.enum(SHOP_MEMBER_STATUSES),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const removeMemberSchema = z.object({ member_id: z.string().uuid() });
