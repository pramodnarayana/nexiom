import type { ApplicationShardModule } from '@soopa/piece-framework';
import { ReplicateQBObject } from './replicate.js';
import { NormaliseQBObject } from './normalise.js';
import { PrepareQBUpdatePayload } from './prepare-update.js';
import { provisionQBDomain } from './provision.js';

export const extractReplica = ReplicateQBObject;
export const normalize = NormaliseQBObject;
export const provisionDomain = provisionQBDomain;
export const prepareUpdate = PrepareQBUpdatePayload;
