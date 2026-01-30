export interface User {
  id: string;
  email: string;
  name?: string | null;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  role: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
  permissions?: string[];
  hasTenant?: boolean;
  organizationId?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
  status: "active" | "disabled" | "suspended";
  createdAt: Date;
  updatedAt?: Date; // Optional as not critical for all projections
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatedBy?: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: string | null;
  organizationId?: string | null;
  inviterId: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: Date;
  createdAt: Date;
}

export interface AuthResult {
  session: Session;
  user: User;
  cookie?: string | string[];
}
