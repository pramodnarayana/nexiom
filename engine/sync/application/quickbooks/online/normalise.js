"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NormaliseQBObject = NormaliseQBObject;
/**
 * QuickBooks objects are usually not normalized into a canonical TMS schema.
 * They stay as raw domain entities for the QB piece.
 */
async function NormaliseQBObject(_entityType, _data) {
    return null; // Signals to the pipeline to store as RAW canonical type
}
