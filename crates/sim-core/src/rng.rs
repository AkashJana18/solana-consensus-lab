//! Small, dependency-free, fully serializable PRNG (xoshiro256**).
//!
//! Every random choice in the simulation flows through one of these so that a
//! scenario + seed reproduces a byte-identical trace on every platform,
//! including wasm32.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rng {
    s: [u64; 4],
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

impl Rng {
    pub fn seed(seed: u64) -> Self {
        let mut st = seed;
        let s = [
            splitmix64(&mut st),
            splitmix64(&mut st),
            splitmix64(&mut st),
            splitmix64(&mut st),
        ];
        Rng { s }
    }

    /// Derive an independent stream, e.g. one per node or per subsystem.
    pub fn fork(&mut self, tag: u64) -> Rng {
        let a = self.next_u64();
        Rng::seed(a ^ tag.wrapping_mul(0xD6E8_FEB8_6659_FD93))
    }

    pub fn next_u64(&mut self) -> u64 {
        let s = &mut self.s;
        let result = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }

    /// Uniform in [0, 1).
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Uniform integer in [0, n). Returns 0 when n == 0.
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }

    pub fn chance(&mut self, p: f64) -> bool {
        p > 0.0 && self.f64() < p
    }

    /// Standard normal via Box–Muller (single sample, no caching, to keep state minimal).
    pub fn normal(&mut self) -> f64 {
        let u1 = self.f64().max(1e-300);
        let u2 = self.f64();
        (-2.0 * u1.ln()).sqrt() * (core::f64::consts::TAU * u2).cos()
    }

    /// Log-normal multiplier with median 1.0 and shape `sigma`.
    pub fn lognormal_unit(&mut self, sigma: f64) -> f64 {
        if sigma <= 0.0 {
            1.0
        } else {
            (sigma * self.normal()).exp()
        }
    }

    /// Index sampled proportionally to `weights`.
    pub fn weighted(&mut self, weights: &[u64]) -> usize {
        let total: u64 = weights.iter().sum();
        if total == 0 {
            return self.below(weights.len() as u64) as usize;
        }
        let mut x = self.below(total);
        for (i, w) in weights.iter().enumerate() {
            if x < *w {
                return i;
            }
            x -= *w;
        }
        weights.len() - 1
    }

    /// `k` distinct indices sampled proportionally to weight (sequential without replacement).
    pub fn weighted_distinct(&mut self, weights: &[u64], k: usize) -> Vec<usize> {
        let mut w = weights.to_vec();
        let k = k.min(w.len());
        let mut out = Vec::with_capacity(k);
        for _ in 0..k {
            let i = self.weighted(&w);
            out.push(i);
            w[i] = 0;
        }
        out
    }

    /// Full stake-weighted permutation (Efraimidis–Spirakis): heavier weights
    /// tend to come first. O(n log n), used for Turbine trees and Rotor relays.
    pub fn weighted_order(&mut self, weights: &[u64]) -> Vec<usize> {
        let mut keyed: Vec<(f64, usize)> = weights
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let u = self.f64().max(1e-300);
                let w = (*w).max(1) as f64;
                (u.ln() / w, i)
            })
            .collect();
        keyed.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)));
        keyed.into_iter().map(|(_, i)| i).collect()
    }

    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.below(i as u64 + 1) as usize;
            v.swap(i, j);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic() {
        let mut a = Rng::seed(42);
        let mut b = Rng::seed(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn weighted_respects_weights() {
        let mut r = Rng::seed(1);
        let mut counts = [0u32; 3];
        for _ in 0..30_000 {
            counts[r.weighted(&[1, 2, 7])] += 1;
        }
        assert!(counts[2] > counts[1] && counts[1] > counts[0]);
    }
}
