//! Simulated time. All timestamps are microseconds since simulation start.

pub type SimTime = u64;

pub const US: SimTime = 1;
pub const MS: SimTime = 1_000;
pub const SEC: SimTime = 1_000_000;

#[inline]
pub fn ms(x: u64) -> SimTime {
    x * MS
}

/// Convert fractional milliseconds to SimTime, rounding to the nearest microsecond.
#[inline]
pub fn ms_f(x: f64) -> SimTime {
    (x * 1000.0).round().max(0.0) as SimTime
}

#[inline]
pub fn to_ms(t: SimTime) -> f64 {
    t as f64 / 1000.0
}
