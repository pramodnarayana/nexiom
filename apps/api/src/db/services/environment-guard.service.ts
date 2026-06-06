import { Injectable } from '@nestjs/common';

@Injectable()
export class EnvironmentGuardService {
  private readonly ALLOWED_ENVS = ['development', 'test', 'local'];

  /**
   * Check if current environment allows destructive operations
   * @throws Error if environment is not safe
   */
  assertSafeEnvironment(): void {
    const env = process.env.NODE_ENV;
    if (!env || !this.ALLOWED_ENVS.includes(env)) {
      throw new Error(
        `Destructive database operations only allowed in: ${this.ALLOWED_ENVS.join(', ')}. Current: ${env || 'unset'}`,
      );
    }
  }

  isSafeEnvironment(): boolean {
    const env = process.env.NODE_ENV;
    return !!env && this.ALLOWED_ENVS.includes(env);
  }
}
