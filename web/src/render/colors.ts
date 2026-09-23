// Single source of truth for colours used on the canvas (numbers) and in CSS chips (strings).
// Categorical hues (shred / vote / cert) validated with the dataviz palette validator
// against the dark canvas surface (#14161b), all-pairs. The hero tx is a highlight
// (white + glow + size), not a fourth categorical hue.

export const HEX = {
  canvas: '#14161b',
  shred: '#3987e5',
  vote: '#199e70',
  cert: '#c98500',
  repair: '#898781',
  hero: '#ffffff',
  nodeFill: '#2a2e38',
  nodeStroke: '#8b93a7',
  nodeSelected: '#ffffff',
  leader: '#fab219',
  rpc: '#e66767',
  region: '#7a8194',
  partition: '#9085e9',
  ringGuide: '#1f232c',
} as const;

export const num = (hex: string): number => parseInt(hex.slice(1), 16);

export const COLOR = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, num(v)])) as Record<
  keyof typeof HEX,
  number
>;

export type KindFamily = 'shred' | 'vote' | 'cert' | 'repair' | 'hero' | 'other';

export function kindFamily(kind: string): KindFamily {
  if (kind === 'shred') return 'shred';
  if (kind === 'tx') return 'hero';
  if (kind.startsWith('vote:')) return 'vote';
  if (kind.startsWith('cert:')) return 'cert';
  if (kind.startsWith('repair:')) return 'repair';
  return 'other';
}

export function kindColor(kind: string): number {
  switch (kindFamily(kind)) {
    case 'shred':
      return COLOR.shred;
    case 'vote':
      return COLOR.vote;
    case 'cert':
      return COLOR.cert;
    case 'repair':
      return COLOR.repair;
    case 'hero':
      return COLOR.hero;
    default:
      return COLOR.nodeStroke;
  }
}

export function kindHex(kind: string): string {
  const f = kindFamily(kind);
  return f === 'other' ? HEX.nodeStroke : HEX[f];
}
