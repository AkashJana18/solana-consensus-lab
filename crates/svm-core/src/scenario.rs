//! Scenario input: a program name, accounts, and the limits the learner can move.

use serde::{Deserialize, Serialize};

use crate::limits::{
    DEFAULT_CU, DEFAULT_HEAP_BYTES, DEFAULT_STACK_BYTES, MAX_CALL_DEPTH, MAX_CU, MAX_HEAP_BYTES,
};
use crate::memory::MappingMode;
use crate::programs::{self, Program};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct AccountSpec {
    pub name: String,
    /// Account data as lowercase hex. The VM receives this serialized into the input region.
    pub data_hex: String,
    pub writable: bool,
    pub owner: String,
    pub lamports: u64,
    pub executable: bool,
}

impl Default for AccountSpec {
    fn default() -> Self {
        AccountSpec {
            name: "account".into(),
            data_hex: String::new(),
            writable: true,
            owner: "11111111111111111111111111111111".into(),
            lamports: 1_000_000,
            executable: false,
        }
    }
}

impl AccountSpec {
    pub fn data(&self) -> Vec<u8> {
        hex_decode(&self.data_hex).unwrap_or_default()
    }

    pub fn from_bytes(name: &str, owner: &str, bytes: &[u8], writable: bool) -> Self {
        AccountSpec {
            name: name.into(),
            data_hex: hex_encode(bytes),
            writable,
            owner: owner.into(),
            lamports: 1_000_000,
            executable: false,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AccountSlot {
    pub index: usize,
    pub name: String,
    pub offset: u64,
    pub len: u64,
    pub writable: bool,
    pub owner: String,
    pub lamports: u64,
    pub executable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Scenario {
    pub program: String,
    pub accounts: Vec<AccountSpec>,
    pub cu_limit: u64,
    pub heap_bytes: usize,
    pub stack_bytes: usize,
    pub call_depth: u32,
    pub elf_bytes: u64,
    pub mapping: MappingMode,
    /// Chapter 2 fault injection: empty | opcode | register | r10 | jump | syscall.
    pub fault: Option<String>,
}

impl Default for Scenario {
    fn default() -> Self {
        let mut counter = [0u8; 8];
        counter.copy_from_slice(&41u64.to_le_bytes());
        let mut config = [0u8; 8];
        config.copy_from_slice(&3u64.to_le_bytes());

        Scenario {
            program: "counter".into(),
            accounts: vec![
                AccountSpec::from_bytes("counter", "Counter1111111111111111111111111111111111", &counter, true),
                AccountSpec::from_bytes("config", "Config11111111111111111111111111111111111", &config, false),
                AccountSpec {
                    name: "payer".into(),
                    data_hex: String::new(),
                    writable: true,
                    owner: "11111111111111111111111111111111".into(),
                    lamports: 1_200_000_000,
                    executable: false,
                },
            ],
            cu_limit: DEFAULT_CU,
            heap_bytes: DEFAULT_HEAP_BYTES,
            stack_bytes: DEFAULT_STACK_BYTES,
            call_depth: MAX_CALL_DEPTH,
            elf_bytes: 24_832,
            mapping: MappingMode::Aligned,
            fault: None,
        }
    }
}

impl Scenario {
    pub fn from_json(json: &str) -> Result<Scenario, String> {
        let scenario: Scenario =
            serde_json::from_str(json).map_err(|e| format!("invalid scenario: {e}"))?;
        scenario.validate()?;
        Ok(scenario)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
    }

    pub fn validate(&self) -> Result<(), String> {
        if programs::builtin(&self.program).is_none() {
            return Err(format!(
                "unknown program '{}' (try {})",
                self.program,
                programs::NAMES.join(" | ")
            ));
        }
        if self.cu_limit > MAX_CU {
            return Err(format!("cu_limit {} exceeds the {} CU ceiling", self.cu_limit, MAX_CU));
        }
        if self.heap_bytes > MAX_HEAP_BYTES {
            return Err(format!("heap_bytes {} exceeds the {} byte ceiling", self.heap_bytes, MAX_HEAP_BYTES));
        }
        if self.stack_bytes % crate::limits::FRAME_BYTES != 0 {
            return Err(format!(
                "stack_bytes must be a multiple of {}",
                crate::limits::FRAME_BYTES
            ));
        }
        Ok(())
    }

    pub fn program(&self) -> Result<Program, String> {
        let program = match &self.fault {
            Some(fault) => programs::with_fault(&self.program, fault)
                .ok_or_else(|| format!("unknown fault '{}'", fault))?,
            None => programs::builtin(&self.program)
                .ok_or_else(|| format!("unknown program '{}'", self.program))?,
        };
        Ok(program)
    }

    /// Serialize accounts into the input region and return the slots that map offsets
    /// back to account names. Everything is 8-byte aligned so u64 reads are natural.
    pub fn serialize_accounts(&self) -> (Vec<AccountSlot>, Vec<u8>) {
        let mut slots = Vec::new();
        let mut input = Vec::new();
        for (index, account) in self.accounts.iter().enumerate() {
            while input.len() % 8 != 0 {
                input.push(0);
            }
            let offset = input.len() as u64;
            let data = account.data();
            input.extend_from_slice(&data);
            while input.len() % 8 != 0 {
                input.push(0);
            }
            slots.push(AccountSlot {
                index,
                name: account.name.clone(),
                offset,
                len: data.len() as u64,
                writable: account.writable,
                owner: account.owner.clone(),
                lamports: account.lamports,
                executable: account.executable,
            });
        }
        if input.is_empty() {
            input.resize(8, 0);
        }
        (slots, input)
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn hex_decode(text: &str) -> Result<Vec<u8>, String> {
    let clean: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.len() % 2 != 0 {
        return Err("hex must have an even number of digits".into());
    }
    let mut out = Vec::with_capacity(clean.len() / 2);
    let bytes = clean.as_bytes();
    for pair in bytes.chunks(2) {
        let hi = (pair[0] as char).to_digit(16).ok_or("invalid hex digit")?;
        let lo = (pair[1] as char).to_digit(16).ok_or("invalid hex digit")?;
        out.push((hi * 16 + lo) as u8);
    }
    Ok(out)
}
