import crypto from "node:crypto";
import type { Machine } from "../types.js";

/**
 * Calculate ETag from stable view fields only
 * ETag hanya dihitung dari: id, type, label, slot, status
 * Abaikan field yang sering berubah: tl, dur, updated_at, meta.ts
 */
export function calculateMachineETag(machines: Machine[]): string {
  const stableView = machines.map((machine) => ({
    id: machine.id,
    type: machine.type,
    label: machine.label,
    slot: machine.slot,
    status: machine.status,
  }));

  const stableData = JSON.stringify(stableView);
  return crypto.createHash("md5").update(stableData).digest("hex");
}

/**
 * Calculate ETag for any data
 */
export function calculateETag(data: any): string {
  const stableData = JSON.stringify(data);
  return crypto.createHash("md5").update(stableData).digest("hex");
}

