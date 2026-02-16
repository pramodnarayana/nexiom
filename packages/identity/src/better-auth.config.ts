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

                // Check for pending invite
                const hasPendingInvite =
                  await tenantProvider.findPendingInvitation(email);

                if (!hasPendingInvite) {
                  // If NO invite, we must manually trigger verification email
                  // because we disabled sendOnSignUp globally.
                  const { emailVerification } = ctx.context.options;
                  if (emailVerification?.sendVerificationEmail) {
                    await ctx.context.runInBackgroundOrAwait(async () => {
                      // We need to generate a token manually since we are outside the flow
                      // Luckily better-auth exposes utilities, but accessing them here requires
                      // using the internal API context tools available.

                      // Actually, we can just call the endpoint "send-verification-email" internally?
                      // Or reuse the logic.
                      // For simplicity and correctness, invoking the internal endpoint is best.
                      // But accessing internal router is hard.

                      // We can use the 'sendVerificationEmail' FUNCTION from options simply:
                      // But we need a TOKEN and URL.
                      // The `signUpEmail` logic usually creates these.

                      // Let's use the adapter's emailService or similar? NO.
                      // We should use the context's internal helper `createEmailVerificationToken` import?
                      // We can't easily import internal functions here.

                      // Alternative: We can call the API endpoint for sending verification email!
                      // This hook runs on the server.
                      // `ctx.context.api` usually exposes the API.
                      if (ctx.request) {
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
                      }
                    });
                  }
                }
              }
            }),
          },
        ],
      },
    },
  ];
};
