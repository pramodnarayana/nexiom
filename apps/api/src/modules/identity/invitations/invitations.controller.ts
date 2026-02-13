import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { CreateInvitation, AcceptInvitation } from './invitations.validation';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '@nexiom/identity';
import {
  AuthContext,
  RequestAuthContext,
} from '../auth/auth-context.decorator';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() createInvitation: CreateInvitation,
    @AuthContext() ctx: RequestAuthContext,
  ) {
    // If specific organization context exists (Tenant Admin), enforce it.
    if (ctx.user.organizationId) {
      createInvitation.organizationId = ctx.user.organizationId;
    }
    // Extract only necessary headers for downstream propagation
    const forwardedHeaders = {
      'x-request-id': ctx.headers.get('x-request-id') ?? undefined,
      'x-forwarded-for': ctx.headers.get('x-forwarded-for') ?? undefined,
    };

    return this.invitationsService.create(
      createInvitation,
      ctx.user.id,
      forwardedHeaders,
    );
  }

  @Get(':id')
  // Public endpoint: Returns limited invitation details for the accept page context.
  async get(@Param('id') id: string) {
    return this.invitationsService.get(id);
  }

  @Post('accept')
  @UseGuards(AuthGuard)
  async accept(
    @Body() acceptInvitation: AcceptInvitation,
    @AuthContext('user') user: User,
  ) {
    return this.invitationsService.accept(
      acceptInvitation.invitationId,
      user.id,
    );
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@AuthContext('user') user: User) {
    if (!user.organizationId) {
      // If no org, return empty or throw. For now empty list.
      return [];
    }
    return this.invitationsService.list(user.organizationId);
  }
}
