import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SystemAdminGuard } from '../../identity/auth/system-admin.guard.js';
import { TransformerSimulationService } from '@soopa/ai-engine';
import { PinoLogger } from 'nestjs-pino';
import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsObject,
  ValidateIf,
} from 'class-validator';

// Using a basic class validator for nestjs pipeline
class TransformerSimulationDto {
  @IsString()
  @IsNotEmpty()
  dataSourceId!: string;

  @IsIn(['hydrator', 'action'])
  toolType!: 'hydrator' | 'action';

  @ValidateIf((o: TransformerSimulationDto) => o.toolType === 'action')
  @IsString()
  @IsNotEmpty({ message: 'actionName is required when toolType is "action"' })
  actionName?: string;

  @IsObject()
  payload!: Record<string, any>;
}

@Controller('ai/transformer')
@UseGuards(SystemAdminGuard) // Requires System Admin privileges
export class TransformerSimulationController {
  constructor(
    private readonly simulationService: TransformerSimulationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TransformerSimulationController.name);
  }

  /**
   * POST /api/v1/ai/transformer/simulate
   *
   * Provides administrators and developers an enterprise testing harness to
   * verify live canonical transformations without spending LLM tokens.
   */
  @Post('simulate')
  async simulate(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: TransformerSimulationDto,
    @Req()
    req: Request & {
      user?: {
        organizationId?: string;
        tenantId?: string;
        systemAdmin?: boolean;
      };
      traceId?: string;
    },
  ) {
    const tenantId: string | undefined =
      req.user?.organizationId ?? req.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Valid tenant ID is required.');
    }

    this.logger.info(
      `Executing Transformer Simulation for Connection: [REDACTED]`,
      { dataSourceId: body.dataSourceId },
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.simulationService.simulateExecution(
      tenantId,
      body.dataSourceId,
      body.toolType,
      body.actionName || null,
      body.payload,
    );
  }
}
