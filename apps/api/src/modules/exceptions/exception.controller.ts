import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  Inject,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@soopa/auth';
import { ExceptionService, type ExceptionStatus } from './exception.service.js';

@Controller('exceptions')
@UseGuards(AuthGuard)
export class ExceptionController {
  constructor(
    @Inject(ExceptionService)
    private readonly exceptionService: ExceptionService,
  ) {}

  /**
   * GET /exceptions?status=unresolved|dismissed&limit=50&cursor=<cursor>
   *
   * Returns paginated FAIL/RETRY/DISMISSED outbound_gateway rows for the org.
   * Uses cursor-based pagination for stable iteration over large org-wide datasets.
   */
  @Get()
  async listExceptions(
    @AuthContext() ctx: RequestAuthContext,
    @Query('status') status?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const orgId = ctx.user?.organizationId;
    if (!orgId) {
      throw new BadRequestException('Organization context is missing');
    }

    if (
      status !== undefined &&
      status !== 'unresolved' &&
      status !== 'dismissed'
    ) {
      throw new BadRequestException(
        'status must be "unresolved" or "dismissed"',
      );
    }

    return this.exceptionService.listExceptions(
      orgId,
      { status: status as ExceptionStatus | undefined },
      { limit, cursor },
    );
  }

  /**
   * POST /exceptions/:id/retry
   *
   * Resets the outbound_gateway row to PENDING and re-enqueues it to
   * the Delivery_Queue so the DeliveryService will attempt it again.
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retryException(
    @AuthContext() ctx: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const orgId = ctx.user?.organizationId;
    if (!orgId) {
      throw new BadRequestException('Organization context is missing');
    }

    return this.exceptionService.retryException(orgId, id);
  }

  /**
   * POST /exceptions/:id/dismiss
   *
   * Marks the outbound_gateway row as DISMISSED so it no longer appears
   * in the unresolved exceptions list.
   */
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismissException(
    @AuthContext() ctx: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const orgId = ctx.user?.organizationId;
    if (!orgId) {
      throw new BadRequestException('Organization context is missing');
    }

    return this.exceptionService.dismissException(orgId, id);
  }
}
