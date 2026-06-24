import { ReplicateQBObject } from './replicate.js';
import { NormaliseQBObject } from './normalise.js';
import { PrepareQBUpdatePayload } from './prepare-update.js';

export const extractReplica = ReplicateQBObject;
export const normalize = NormaliseQBObject;
export const prepareUpdate = PrepareQBUpdatePayload;
