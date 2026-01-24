import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateInvitationSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1),
  organizationId: z.string().optional(), // Optional for platform invites
});

export class CreateInvitation extends createZodDto(CreateInvitationSchema) {}

export const AcceptInvitationSchema = z.object({
  invitationId: z.string().min(1),
  token: z.string().min(1), // Usually token is needed for security if not using session
  // Actually, better-auth acceptInvitation usually just needs invitationId if the user is logged in,
  // or token if it's a magic link flow.
  // The 'acceptInvitation' in better-auth often requires a session.
  // If we want a "SignUp via Invite" flow, we might need a different approach.
  // But let's start with standard accepts.
});

export class AcceptInvitation extends createZodDto(AcceptInvitationSchema) {}
