//! The five-region sBPF address space and the VM-to-host mapping.
//!
//! This is the heart of Chapter 1: from inside the VM only the inner address space
//! exists, but every region is a window onto memory the validator already owns.

use serde::{Deserialize, Serialize};

use crate::limits::{
    HEAP_BASE, HEAP_HOST, INPUT_BASE, INPUT_HOST, REGION_SLICE, RODATA_BASE, RODATA_HOST,
    STACK_BASE, STACK_HOST, TEXT_BASE, TEXT_HOST,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Region {
    Text,
    Rodata,
    Stack,
    Heap,
    Input,
}

impl Region {
    pub const ALL: [Region; 5] = [
        Region::Text,
        Region::Rodata,
        Region::Stack,
        Region::Heap,
        Region::Input,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Region::Text => "text",
            Region::Rodata => "rodata",
            Region::Stack => "stack",
            Region::Heap => "heap",
            Region::Input => "input",
        }
    }

    pub fn base(self) -> u64 {
        match self {
            Region::Text => TEXT_BASE,
            Region::Rodata => RODATA_BASE,
            Region::Stack => STACK_BASE,
            Region::Heap => HEAP_BASE,
            Region::Input => INPUT_BASE,
        }
    }

    pub fn host_base(self) -> u64 {
        match self {
            Region::Text => TEXT_HOST,
            Region::Rodata => RODATA_HOST,
            Region::Stack => STACK_HOST,
            Region::Heap => HEAP_HOST,
            Region::Input => INPUT_HOST,
        }
    }

    pub fn writable(self) -> bool {
        matches!(self, Region::Stack | Region::Heap | Region::Input)
    }

    pub fn description(self) -> &'static str {
        match self {
            Region::Text => "The ELF .text section: verified sBPF instructions, read-only.",
            Region::Rodata => "The ELF .rodata section: constants and read-only globals.",
            Region::Stack => "One 4 KiB frame per call, growing down from the top of the slice.",
            Region::Heap => "Program-requested heap. Zeroed before the program starts.",
            Region::Input => "Serialized account data and instruction data, copied in before execution.",
        }
    }
}

/// Resolve an absolute VM address to a region and an offset within it.
pub fn region_of(addr: u64) -> Option<(Region, u64)> {
    for region in Region::ALL {
        let start = region.base();
        if addr >= start && addr - start < REGION_SLICE {
            return Some((region, addr - start));
        }
    }
    None
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MappingMode {
    /// Test mode: the VM address is the host address.
    Identity,
    /// The current implementation: the host address must preserve the VM's alignment.
    Aligned,
    /// Future implementation: flexible alignment, so the low bits can shift.
    Unaligned,
}

impl MappingMode {
    pub fn label(self) -> &'static str {
        match self {
            MappingMode::Identity => "Identity",
            MappingMode::Aligned => "Aligned",
            MappingMode::Unaligned => "Unaligned",
        }
    }
}

#[derive(Debug, thiserror::Error, Serialize)]
pub enum MemError {
    #[error("{region} out of bounds: offset {offset} + {len} exceeds {size}")]
    OutOfBounds {
        region: &'static str,
        offset: u64,
        len: u64,
        size: u64,
    },
    #[error("{region} is read-only")]
    Forbidden { region: &'static str },
    #[error("misaligned {region} access: {offset:#x} is not {align}-byte aligned")]
    Misaligned {
        region: &'static str,
        offset: u64,
        align: u64,
    },
    #[error("address {addr:#x} is outside the five sBPF regions")]
    Unmapped { addr: u64 },
    #[error("no writable account covers input bytes {offset}..{end}")]
    ReadOnlyAccount { offset: u64, end: u64 },
    #[error("write crosses an account boundary at input byte {offset}")]
    CrossesAccount { offset: u64 },
}

/// Translate a region offset into the host address the validator would see.
pub fn host_address(
    region: Region,
    offset: u64,
    mode: MappingMode,
    align: u64,
) -> Result<u64, MemError> {
    if offset >= REGION_SLICE {
        return Err(MemError::OutOfBounds {
            region: region.name(),
            offset,
            len: 0,
            size: REGION_SLICE,
        });
    }
    if mode == MappingMode::Aligned && align > 0 && offset % align != 0 {
        return Err(MemError::Misaligned {
            region: region.name(),
            offset,
            align,
        });
    }
    Ok(match mode {
        MappingMode::Identity => region.base() + offset,
        MappingMode::Aligned | MappingMode::Unaligned => region.host_base() + offset,
    })
}

/// The bytes behind each region. In a real validator these are ELF segments, a
/// VmMemoryPool slice, and the serialized input buffer.
#[derive(Clone, Debug)]
pub struct Memory {
    text: Vec<u8>,
    rodata: Vec<u8>,
    stack: Vec<u8>,
    heap: Vec<u8>,
    input: Vec<u8>,
}

impl Memory {
    pub fn new(
        text: Vec<u8>,
        rodata: Vec<u8>,
        stack_bytes: usize,
        heap_bytes: usize,
        input: Vec<u8>,
    ) -> Self {
        Memory {
            text,
            rodata,
            stack: vec![0; stack_bytes],
            heap: vec![0; heap_bytes],
            input,
        }
    }

    pub fn bytes(&self, region: Region) -> &[u8] {
        match region {
            Region::Text => &self.text,
            Region::Rodata => &self.rodata,
            Region::Stack => &self.stack,
            Region::Heap => &self.heap,
            Region::Input => &self.input,
        }
    }

    pub fn read(&self, region: Region, offset: u64, len: u64) -> Result<&[u8], MemError> {
        let bytes = self.bytes(region);
        let start = offset as usize;
        let end = start.checked_add(len as usize).ok_or(MemError::OutOfBounds {
            region: region.name(),
            offset,
            len,
            size: bytes.len() as u64,
        })?;
        if end > bytes.len() {
            return Err(MemError::OutOfBounds {
                region: region.name(),
                offset,
                len,
                size: bytes.len() as u64,
            });
        }
        Ok(&bytes[start..end])
    }

    pub fn write(&mut self, region: Region, offset: u64, data: &[u8]) -> Result<(), MemError> {
        if !region.writable() {
            return Err(MemError::Forbidden {
                region: region.name(),
            });
        }
        let bytes = match region {
            Region::Text => &mut self.text,
            Region::Rodata => &mut self.rodata,
            Region::Stack => &mut self.stack,
            Region::Heap => &mut self.heap,
            Region::Input => &mut self.input,
        };
        let start = offset as usize;
        let end = start.checked_add(data.len()).ok_or(MemError::OutOfBounds {
            region: region.name(),
            offset,
            len: data.len() as u64,
            size: bytes.len() as u64,
        })?;
        if end > bytes.len() {
            return Err(MemError::OutOfBounds {
                region: region.name(),
                offset,
                len: data.len() as u64,
                size: bytes.len() as u64,
            });
        }
        bytes[start..end].copy_from_slice(data);
        Ok(())
    }

    /// Copy committed input bytes back out, for the account panel.
    pub fn input(&self) -> &[u8] {
        &self.input
    }
}

pub fn read_le(bytes: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    let n = bytes.len().min(8);
    buf[..n].copy_from_slice(&bytes[..n]);
    u64::from_le_bytes(buf)
}

pub fn write_le(value: u64, len: u8) -> Vec<u8> {
    value.to_le_bytes()[..len as usize].to_vec()
}
