import { registerReplicaExtractor, registerNormalizer } from '@nexiom/piece-framework';
import { upsertRevenovaObject } from './upsertRevenovaObject.js';
import { upsertTMSObject } from './upsertTMSObject.js';

export function initializeRevenovaApplicationRegistry() {
    registerReplicaExtractor('salesforce', 'revenova', upsertRevenovaObject);
    registerNormalizer('salesforce', 'revenova', upsertTMSObject);
}
