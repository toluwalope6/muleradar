import type { AccountRole, IndicatorType, Priority } from '../data/types';

export const INDICATOR_LABELS: Record<IndicatorType, string> = {
  circular_flow: 'Circular flow',
  rapid_fan_in: 'Rapid fan-in',
  rapid_fan_out: 'Rapid fan-out',
  rapid_pass_through: 'Rapid pass-through',
  near_threshold_amounts: 'Near-threshold amounts',
  new_account: 'Newly opened account',
};

export const ROLE_LABELS: Record<AccountRole, string> = {
  origin: 'Origin',
  source: 'Source',
  collector: 'Collector',
  intermediary: 'Intermediary',
  destination: 'Destination',
  context: 'Context',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};
