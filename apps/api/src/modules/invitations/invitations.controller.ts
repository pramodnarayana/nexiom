import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { CreateInvitation, AcceptInvitation } from './invitations.validation';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() createInvitation: CreateInvitation,
    @Req() req: Request & { user: { id: string; organizationId?: string } },
  ) {
    // Strict Enforcement: Invites are ALWAYS for the current user's organization.
    // No explicit override allowed via API body.
    createInvitation.organizationId = req.user.organizationId;

    // Pass headers to propagate auth context to BetterAuth client
    const headers = new Headers(req.headers as Record<string, string>);
    return this.invitationsService.create(
      createInvitation,
      req.user.id,
      headers,
    );
  }

  @Get(':id')
  // We should probably guard this or validate the ID format is safe/expected
  async get(@Param('id') id: string) {
    return this.invitationsService.get(id);
  }

  @Post('accept')
  @UseGuards(AuthGuard)
  async accept(
    @Body() acceptInvitation: AcceptInvitation,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.invitationsService.accept(
      acceptInvitation.invitationId,
      req.user.id,
    );
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(
    @Req() req: Request & { user: { id: string; organizationId?: string } },
  ) {
    if (!req.user.organizationId) {
      // If no org, return empty or throw. For now empty list.
      return [];
    }
    return this.invitationsService.list(req.user.organizationId);
  }
}
