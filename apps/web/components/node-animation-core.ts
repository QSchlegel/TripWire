export function dampValue(current: number, target: number, dt: number, speed: number): number {
  if (speed <= 0 || dt <= 0) return current;
  const alpha = 1 - Math.exp(-speed * dt);
  return current + (target - current) * alpha;
}

export function decayValue(current: number, dt: number, decayPerSecond: number): number {
  if (current <= 0 || dt <= 0) return 0;
  if (decayPerSecond <= 0) return current;
  const next = current * Math.exp(-decayPerSecond * dt);
  return next < 0.0001 ? 0 : next;
}

export function proximityFalloff(distance: number, radius: number): number {
  if (radius <= 0 || distance >= radius) return 0;
  const normalized = 1 - distance / radius;
  return normalized * normalized;
}
