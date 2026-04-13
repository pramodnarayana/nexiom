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
import { AuthGuard } from '@nexiom/auth';
import { TransformerSimulationService } from '@nexiom/ai-engine';
import { PinoLogger } from 'nestjs-pino';
import { IsString, IsNotEmpty, IsIn, IsOptional, IsObject, ValidateIf } from 'class-validator';

// Using a basic class validator for nestjs pipeline
class TransformerSimulationDto {
  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  @IsIn(['hydrator', 'action'])
  toolType!: 'hydrator' | 'action';

  @ValidateIf((o) => o.toolType === 'action')
  @IsString()
  @IsNotEmpty({ message: 'actionName is required when toolType is "action"' })
  actionName?: string;

  @IsObject()
  payload!: Record<string, any>;
}

@Controller('ai/transformer')
@UseGuards(AuthGuard) // Requires valid Nexiom active session
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
    // RBAC: Ensure the user is a system admin to run sandbox traces
    if (req.user?.systemAdmin !== true) {
      throw new ForbiddenException('Forbidden. Sandbox API requires System Admin privileges.');
    }

    const tenantId: string | undefined = req.user?.organizationId ?? req.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('Valid tenant ID is required.');
    }

    this.logger.info(
      `Executing Transformer Simulation for Connection: [REDACTED]`,
      { connectionId: body.connectionId },
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.simulationService.simulateExecution(
      tenantId,
      body.connectionId,
      body.toolType,
      body.actionName || null,
      body.payload,
    );
  }
}