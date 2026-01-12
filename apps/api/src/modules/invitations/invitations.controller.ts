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
import { CreateInvitation } from './invitations.validation';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() createInvitation: CreateInvitation,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.invitationsService.create(createInvitation, req.user.id);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    // Assuming this can be public if the ID is a secure token.
    // If it's a predictable ID, we should guard it.
    // Better Auth invitations often use a secure ID/token.
    return this.invitationsService.get(id);
  }

  @Post('accept')
  @UseGuards(AuthGuard)
  async accept(
    @Body('invitationId') invitationId: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.invitationsService.accept(invitationId, req.user.id);
  }
}
