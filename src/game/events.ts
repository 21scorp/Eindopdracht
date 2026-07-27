/**
 * Gameplay event contract.
 *
 * Combat emits facts; audio, VFX, quests, analytics and the share card all
 * listen. Nothing in `GameSession` knows those systems exist.
 */

import type { Threat } from './Threat';
import type { UltimateId } from '../data/guardians';

export type HitQuality = 'block' | 'perfect' | 'parry' | 'chain';

export interface HitEvent {
  quality: HitQuality;
  x: number;
  y: number;
  angle: number;
  threat: Threat;
  /** Score after multipliers. */
  score: number;
  combo: number;
  multiplier: number;
  killed: boolean;
}

export interface RunStats {
  score: number;
  wave: number;
  maxCombo: number;
  blocks: number;
  perfects: number;
  parries: number;
  chains: number;
  kills: number;
  bossKills: number;
  ultimatesUsed: number;
  duration: number;
  integrityLeft: number;
  /** Perfects + parries over total defensive contacts, 0..1. */
  accuracy: number;
  guardianId: string;
  seed: string;
  /** Resonance cards taken this run, in order. */
  resonance: string[];
  /** Multiplier the run's cards put on its core payout. */
  coreMult: number;
}

export type GameEvents = {
  hit: HitEvent;
  threatKilled: { threat: Threat; x: number; y: number; byUltimate: boolean };
  bossSpawn: { threat: Threat };
  bossDamaged: { threat: Threat; hp: number; maxHp: number };
  bossKilled: { threat: Threat; x: number; y: number };
  bossEnraged: { threat: Threat };
  damage: { integrity: number; x: number; y: number; fatal: boolean };
  comboBreak: { combo: number };
  comboMilestone: { combo: number; multiplier: number };
  overdriveStart: { combo: number };
  overdriveEnd: Record<string, never>;
  pulse: { success: boolean; caught: number };
  pulseReady: Record<string, never>;
  waveStart: { wave: number; boss: boolean };
  waveClear: { wave: number; bonus: number };
  ultimateReady: Record<string, never>;
  ultimateFired: { id: UltimateId };
  runStart: { guardianId: string; seed: string };
  runEnd: { stats: RunStats };
  lastStand: Record<string, never>;
  secondWind: Record<string, never>;
  heraldShot: { x: number; y: number; angle: number };
  resonanceTaken: { id: string; name: string; tier: string };
};
