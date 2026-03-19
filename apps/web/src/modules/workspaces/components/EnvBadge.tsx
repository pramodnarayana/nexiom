import { Badge } from '@/shared/components/ui/badge';
import type { EnvType } from '../api/workspaces.api';

export function EnvBadge({ envType }: Readonly<{ envType: EnvType }>) {
  return (
    <Badge
      variant="outline"
      className={
        envType === 'SANDBOX'
          ? 'border-amber-400 text-amber-600'
          : 'border-green-500 text-green-700'
      }
    >
      {envType}
    </Badge>
  );
}
