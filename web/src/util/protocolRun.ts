import type { Protocol } from '../engine/types';

/**
 * Pick one protocol's value out of a per-protocol record.
 *
 * Written as a Record rather than a chain of ternaries on purpose: `p === 'tower' ? tower :
 * alpenglow` type-checks fine once a third protocol exists and quietly renders the wrong
 * run's data under the right heading. Keying on Protocol means adding a protocol here is a
 * compile error instead of a silent bug.
 */
export function forProtocol<T>(protocol: Protocol, byProtocol: Record<Protocol, T | undefined>): T | undefined {
  return byProtocol[protocol];
}
