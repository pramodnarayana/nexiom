import type { ApplicationShardModule } from '@nexiom/piece-framework';
import { ReplicateRevenovaObject } from './replicate.js';
import { NormaliseRevenovaObject } from './normalise.js';
import { WriteRevenovaNormalisedObject } from './write-normalised.js';
import { BuildRevenovaTargetPayload } from './build-target.js';
import { provisionRevenovaDomain } from './provision.js';

export const extractReplica = ReplicateRevenovaObject;
export const normalize = NormaliseRevenovaObject;
export const writeNormalized = WriteRevenovaNormalisedObject;
export const buildTarget = BuildRevenovaTargetPayload;
export const provisionDomain = provisionRevenovaDomain;
