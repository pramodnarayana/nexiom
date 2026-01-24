export interface Invitation {
  id: string;
  email: string;
  role: string | null;
  organizationId: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  expiresAt: Date;
  inviterId: string;
  createdAt?: Date;
}
