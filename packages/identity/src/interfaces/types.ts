export interface User {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  systemRole?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  status: "active" | "disabled" | "suspended";
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
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
