import { validateFrontendUrl } from "./utils/url.util";
import { organization, admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { createAuthMiddleware } from "better-auth/api";
import type { ITenantProvider } from "./interfaces/tenant-provider.interface";
import type { IEmailProvider } from "./interfaces/email-provider.interface";
import type { BetterAuthAdapterConfig } from "./interfaces/better-auth-config.interface";
import type { User as UserInterface } from "./interfaces";
// ... (existing imports)

import type { HookEndpointContext } from "better-auth";

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
  } as const;

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
          matcher: (context: HookEndpointContext) => {
            const path = context.path;
            if (!path) return false;
            // Only trigger on Social Login Callback
            return path.startsWith("/callback/");
          },
          handler: createAuthMiddleware(async (ctx) => {
            const returned = (ctx.context as { returned?: unknown }).returned;

            let user: UserInterface | undefined;

            if (returned && typeof returned === "object") {
              if ("user" in returned) {
                user = (returned as { user: unknown }).user as UserInterface;
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
                    // Structured logs for observability
                    console.error(
                      JSON.stringify({
                        event: "tenant_provisioning_failure",
                        userId: user.id,
                        error: err instanceof Error ? err.message : err,
                        timestamp: new Date().toISOString(),
                      }),
                    );
                  }
                }
              } catch (error) {
                console.error(
                  JSON.stringify({
                    event: "tenant_lookup_failure",
                    userId: user.id,
                    error: error instanceof Error ? error.message : error,
                    timestamp: new Date().toISOString(),
                  }),
                );
              }
            }
          }),
        },
      ],
    },
  };

  return [
    organization({
      ac: ac,
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
    {
      id: "signup-orchestration",
      hooks: {
        after: [
          {
            matcher: (context: HookEndpointContext) => {
              return context.path === "/sign-up/email";
            },
            handler: createAuthMiddleware(async (ctx) => {
              const response = (ctx.context as { returned?: unknown }).returned;

              // Ensure we have a successful response with a user
              if (
                response &&
                typeof response === "object" &&
                "user" in response &&
                (response as { user: UserInterface }).user
              ) {
                const user = (response as { user: UserInterface }).user;
                const email = user.email;

                const { emailVerification } = ctx.context.options;
                if (emailVerification?.sendVerificationEmail) {
                  await ctx.context.runInBackgroundOrAwait(async () => {
                    try {
                      // Check for pending invite
                      const hasPendingInvite =
                        await tenantProvider.findPendingInvitation(email);

                      if (!hasPendingInvite) {
                        // Invoke internal sendVerificationEmail endpoint to reuse existing verification token and email logic when running outside the normal signup flow
                        if (
                          ctx.request &&
                          ctx.context &&
                          "api" in ctx.context &&
                          typeof (
                            ctx.context as unknown as {
                              api: { sendVerificationEmail: unknown };
                            }
                          ).api.sendVerificationEmail === "function"
                        ) {
                          const api = (
                            ctx.context as unknown as {
                              api: {
                                sendVerificationEmail: (opts: {
                                  body: { email: string };
                                  headers: Headers;
                                }) => Promise<void>;
                              };
                            }
                          ).api;

                          await api.sendVerificationEmail({
                            body: { email: user.email },
                            headers: ctx.request.headers,
                          });
                        } else {
                          console.error(
                            JSON.stringify({
                              event: "signup_orchestration_failure",
                              error:
                                "Internal API sendVerificationEmail not available",
                              email: user.email,
                              timestamp: new Date().toISOString(),
                            }),
                          );
                        }
                      }
                    } catch (error) {
                      console.error(
                        JSON.stringify({
                          event: "signup_orchestration_error",
                          error: error instanceof Error ? error.message : error,
                          email: user.email,
                          timestamp: new Date().toISOString(),
                        }),
                      );
                    }
                  });
                }
              }
            }),
          },
        ],
      },
    },
  ];
};
