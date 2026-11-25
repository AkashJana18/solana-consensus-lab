//! Every number the lab shows lives here, with where it came from.
//!
//! The lecture is explicit that some limits are fuzzy ("ask in class"). Rather than
//! inventing a number, each constant carries a provenance so the UI can say which
//! claims are source-backed, documented, or still lecture folklore.

use serde::Serialize;

/// Where a number came from. The UI renders these as green, amber and grey badges.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provenance {
    /// Read from Agave, the sBPF VM, or the SBF toolchain.
    Source,
    /// Stated in Solana documentation or a SIMD.
    Docs,
    /// From the Lecture 5 notes, including the parts the notes flag as uncertain.
    Lecture,
}

#[derive(Clone, Debug, Serialize)]
pub struct Constant {
    pub name: &'static str,
    pub value: String,
    pub provenance: Provenance,
    pub note: &'static str,
}

/// One 4 GiB slice per region. The VM's address space is five of these.
pub const REGION_SLICE: u64 = 4 * 1024 * 1024 * 1024;

pub const TEXT_BASE: u64 = 0x0000_0000;
pub const RODATA_BASE: u64 = 0x1_0000_0000;
pub const STACK_BASE: u64 = 0x2_0000_0000;
pub const HEAP_BASE: u64 = 0x3_0000_0000;
pub const INPUT_BASE: u64 = 0x4_0000_0000;

/// Real host addresses are ASLR-dependent; these are stable stand-ins for the diagram.
pub const TEXT_HOST: u64 = 0x0000_55f0_0000_0000;
pub const RODATA_HOST: u64 = 0x0000_55f0_1000_0000;
pub const STACK_HOST: u64 = 0x0000_58a0_1234_0000;
pub const HEAP_HOST: u64 = 0x0000_58a0_5678_0000;
pub const INPUT_HOST: u64 = 0x0000_58a0_9abc_0000;

pub const FRAME_BYTES: usize = 4096;
pub const MAX_CALL_DEPTH: u32 = 64;
pub const DEFAULT_STACK_BYTES: usize = 64 * FRAME_BYTES;

pub const DEFAULT_CU: u64 = 200_000;
pub const MAX_CU: u64 = 1_400_000;

pub const DEFAULT_HEAP_BYTES: usize = 32 * 1024;
pub const MAX_HEAP_BYTES: usize = 256 * 1024;

pub const MAX_PROGRAM_BYTES: u64 = 10 * 1024 * 1024;

pub fn constants() -> Vec<Constant> {
    vec![
        Constant {
            name: "Region slice",
            value: "4 GiB".into(),
            provenance: Provenance::Source,
            note: "Each of the five sBPF regions reserves a 4 GiB window of the VM address space.",
        },
        Constant {
            name: "Stack frame",
            value: "4 KiB".into(),
            provenance: Provenance::Source,
            note: "Every call frame, including each CPI frame, gets its own 4 KiB.",
        },
        Constant {
            name: "Max call depth",
            value: "64 frames".into(),
            provenance: Provenance::Source,
            note: "Recursion is rejected by the verifier; deep CPI chains hit the same wall.",
        },
        Constant {
            name: "Default compute budget",
            value: "200,000 CU".into(),
            provenance: Provenance::Source,
            note: "A transaction can request up to 1.4M CU. The economic wall is usually CU, not address space.",
        },
        Constant {
            name: "Max program size",
            value: "10 MiB".into(),
            provenance: Provenance::Docs,
            note: "The BPF loader rejects an ELF image larger than this.",
        },
        Constant {
            name: "Heap",
            value: "32 KiB default".into(),
            provenance: Provenance::Docs,
            note: "Programs can request more heap, up to 256 KiB.",
        },
        Constant {
            name: "Stack and heap backing",
            value: "host heap".into(),
            provenance: Provenance::Lecture,
            note: "The VM's stack and heap are slices of a Vec<u8> owned by the validator process.",
        },
        Constant {
            name: "Virtual ceiling",
            value: "5 x 4 GiB".into(),
            provenance: Provenance::Lecture,
            note: "The address space is huge; compute is what actually runs out first.",
        },
    ]
}
