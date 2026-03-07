import {
  CreateInvitationSchema,
  AcceptInvitationSchema,
} from './invitations.validation.js';

describe('InvitationsValidation', () => {
  describe('CreateInvitationSchema', () => {
    it('should validate valid invitation request', () => {
      const valid = {
        email: 'test@example.com',
        role: 'member',
        organizationId: 'org-123',
      };
      expect(CreateInvitationSchema.safeParse(valid).success).toBe(true);
    });

    it('should require valid email', () => {
      const invalid = {
        email: 'invalid',
        role: 'member',
        organizationId: 'org-123',
      };
      expect(CreateInvitationSchema.safeParse(invalid).success).toBe(false);
    });

    it('should allow optional organizationId', () => {
      const validWithoutOrg = {
        email: 'test@example.com',
        role: 'member',
      };
      expect(CreateInvitationSchema.safeParse(validWithoutOrg).success).toBe(
        true,
      );
    });

    it('should require role', () => {
      const invalid = {
        email: 'test@example.com',
        organizationId: 'org-123',
      };
      expect(CreateInvitationSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('AcceptInvitationSchema', () => {
    it('should validate valid accept request', () => {
      const valid = {
        invitationId: 'inv-123',
        token: 'some-token',
      };
      expect(AcceptInvitationSchema.safeParse(valid).success).toBe(true);
    });

    it('should require invitationId', () => {
      const invalid = {};
      expect(AcceptInvitationSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
