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
    // If specific organization context exists (Tenant Admin), enforce it.
    if (req.user.organizationId) {
      createInvitation.organizationId = req.user.organizationId;
    }
    // Otherwise (System Admin), usage of organizationId from body is allowed.

    // Otherwise (System Admin), usage of organizationId from body is allowed.

    return this.invitationsService.create(
      createInvitation,
      req.user.id,
      req.headers,
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
