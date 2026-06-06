import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { WorkspaceRepository } from '../repositories/workspace.repository.js';
import { isUniqueViolation } from '../../../shared/db.utils.js';

interface CreateWorkspaceDto {
  name: string;
  envType?: 'PRODUCTION' | 'SANDBOX';
}

@Injectable()
export class WorkspaceProvisionerUseCase {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async execute(orgId: string, body: CreateWorkspaceDto) {
    try {
      const workspace = await this.workspaceRepository.createWorkspace(orgId, {
        name: body.name,
        envType: body.envType ?? 'PRODUCTION',
      });

      if (!workspace) {
        throw new InternalServerErrorException('Insert did not return a row.');
      }

      return workspace;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A ${body.envType ?? 'PRODUCTION'} workspace named "${body.name}" already exists in this organisation.`,
        );
      }
      throw err;
    }
  }
}
