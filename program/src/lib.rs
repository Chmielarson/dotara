// program/src/lib.rs
pub mod solana_io;

use solana_program::entrypoint;

// Poprawne użycie makra entrypoint - bez :: w środku
#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    solana_io::process_instruction(program_id, accounts, instruction_data)
}