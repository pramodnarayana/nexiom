import { organization, admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { createAuthMiddleware } from "better-auth/api";
import type { ITenantProvider } from "./interfaces/tenant-provider.interface";
import type { IEmailProvider } from "./interfaces/email-provider.interface";
import type { BetterAuthAdapterConfig } from "./interfaces/better-auth-config.interface";
import type { User as UserInterface } from "./interfaces";

/**
 * Factory to configure Better Auth plugins.
 * Separation of concerns: Adapter handles execution, Factory handles configuration.
 */
export const getBetterAuthPlugins = (
  emailService: IEmailProvider,
  config: BetterAuthAdapterConfig,
  tenantProvider: ITenantProvider,
) => {
  // Define statements matching Better Auth's organization plugin expectations
  const statement = {
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
  };

  const ac = createAccessControl(statement);

  const ownerRole = ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
  });

  const adminRole = ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
  });

  const memberRole = ac.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
  });

  // Enterprise Plugin for Tenant Auto-Provisioning
  const tenantProvisioningPlugin = {
    id: "tenant-provisioning",
    hooks: {
      after: [
        {
          matcher: (context: { path?: string }) => {
            const path = context.path;
            if (!path) return false;
            // Only trigger on Social Login Callback
            return path.startsWith("/callback/");
          },
          handler: createAuthMiddleware(async (ctx: any) => {
            // Context returned contains the user info from the original action
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
            const returned = ctx.context.returned;

            let user: UserInterface | undefined;

            if (returned && typeof returned === "object") {
              if ("user" in returned || "token" in returned) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                user = returned.user as UserInterface;
              }
            }

            if (user?.id) {
              try {
                // Idempotent Check: Handled by provisionTenantForUser logic
                const existing = await tenantProvider.findAllForUser(user.id);
                if (existing.length === 0) {
                  try {
                    await tenantProvider.provisionTenantForUser(user.id);
                  } catch (err) {
                    console.error(
                      `[BetterAuth Hook] Failed to provision tenant for ${user.id}`,
                      err,
                    );
                  }
                }
              } catch (error) {
                console.error(`[BetterAuth Hook] verification failed`, error);
              }
            }
          }),
        },
      ],
    },
  };

  return [
    organization({
      roles: {
        owner: ownerRole,
        admin: adminRole,
        member: memberRole,
      },
      sendInvitationEmail: async (data) => {
        const frontendUrl = validateFrontendUrl(
          config.frontendUrl,
          config.allowedOrigins,
        );
        const inviteUrl = `${frontendUrl}/invite/accept?id=${data.invitation.id}&email=${encodeURIComponent(data.email)}`;

        await emailService.sendEmail({
          to: data.email,
          subject: "You have been invited to join an organization",
          text: `You have been invited to join ${data.organization.name}. Click here to accept: ${inviteUrl}`,
          html: `<p>You have been invited to join <strong>${data.organization.name}</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
        });
      },
    }),
    admin(),
    tenantProvisioningPlugin,
  ];
};

// Helper to validate frontend URL (Matches Adapter logic)
function validateFrontendUrl(
  url: string | undefined,
  allowedOrigins: string[],
): string {
  if (url && allowedOrigins.includes(url)) {
    return url;
  }
  return allowedOrigins[0];
}
