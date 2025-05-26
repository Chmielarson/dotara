// program/src/solana_io.rs
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program::{invoke, invoke_signed},
    system_instruction,
    sysvar::{rent::Rent, Sysvar, clock::Clock},
};
use borsh::{BorshDeserialize, BorshSerialize};

/// Stany gry
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub enum GameStatus {
    WaitingForPlayers,
    InProgress,
    Completed,
}

/// Struktura danych gry - maksymalnie zoptymalizowana
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GameRoom {
    pub creator: Pubkey,                  // 32 bajty
    pub players: [Pubkey; 10],            // 320 bajtów (zmniejszone z 20 do 10)
    pub eliminated: [bool; 10],           // 10 bajtów
    pub player_count: u8,                 // 1 bajt
    pub max_players: u8,                  // 1 bajt
    pub entry_fee_lamports: u64,          // 8 bajtów
    pub status: GameStatus,               // 1 bajt
    pub winner: Option<Pubkey>,           // 33 bajty
    pub created_at: i64,                  // 8 bajtów
    pub game_started_at: Option<i64>,     // 9 bajtów
    pub game_ended_at: Option<i64>,       // 9 bajtów
    pub prize_claimed: bool,              // 1 bajt
    pub game_id: [u8; 16],               // 16 bajtów (zmniejszone z 32)
    pub room_slot: u8,                   // 1 bajt
    pub game_duration_minutes: u16,       // 2 bajty
    pub map_size: u16,                   // 2 bajty
}

impl GameRoom {
    pub const SIZE: usize = 512; // Zmniejszone z 1024
    pub const HEADER_SIZE: usize = 4;
    
    pub fn new(creator: Pubkey, max_players: u8, entry_fee_lamports: u64, 
               created_at: i64, room_slot: u8, game_duration_minutes: u16, 
               map_size: u16) -> Self {
        let mut players = [Pubkey::default(); 10];
        players[0] = creator;
        
        Self {
            creator,
            players,
            eliminated: [false; 10],
            player_count: 1,
            max_players,
            entry_fee_lamports,
            status: GameStatus::WaitingForPlayers,
            winner: None,
            created_at,
            game_started_at: None,
            game_ended_at: None,
            prize_claimed: false,
            game_id: [0u8; 16],
            room_slot,
            game_duration_minutes,
            map_size,
        }
    }
    
    pub fn add_player(&mut self, player: Pubkey) -> Result<(), ProgramError> {
        if self.player_count >= self.max_players {
            return Err(ProgramError::InvalidArgument);
        }
        
        // Sprawdź czy gracz już jest w pokoju
        for i in 0..self.player_count as usize {
            if self.players[i] == player {
                return Err(ProgramError::InvalidArgument);
            }
        }
        
        self.players[self.player_count as usize] = player;
        self.player_count += 1;
        Ok(())
    }
    
    pub fn eliminate_player(&mut self, player: Pubkey) -> Result<(), ProgramError> {
        for i in 0..self.player_count as usize {
            if self.players[i] == player {
                self.eliminated[i] = true;
                return Ok(());
            }
        }
        Err(ProgramError::InvalidArgument)
    }
    
    pub fn count_active_players(&self) -> u8 {
        let mut count = 0;
        for i in 0..self.player_count as usize {
            if !self.eliminated[i] {
                count += 1;
            }
        }
        count
    }
    
    pub fn find_last_active_player(&self) -> Option<Pubkey> {
        let mut last_player = None;
        for i in 0..self.player_count as usize {
            if !self.eliminated[i] {
                if last_player.is_some() {
                    return None; // Więcej niż jeden aktywny gracz
                }
                last_player = Some(self.players[i]);
            }
        }
        last_player
    }
    
    pub fn from_account_data(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::HEADER_SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let size_bytes: [u8; 4] = data[..4].try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let data_size = u32::from_le_bytes(size_bytes) as usize;
        
        if data.len() < Self::HEADER_SIZE + data_size {
            return Err(ProgramError::InvalidAccountData);
        }
        
        Self::try_from_slice(&data[Self::HEADER_SIZE..Self::HEADER_SIZE + data_size])
            .map_err(|_| ProgramError::InvalidAccountData)
    }
    
    pub fn to_account_data(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        
        for byte in data.iter_mut() {
            *byte = 0;
        }
        
        let mut temp_buffer = Vec::new();
        self.serialize(&mut temp_buffer)?;
        
        let data_size = temp_buffer.len();
        if data_size + Self::HEADER_SIZE > data.len() {
            return Err(ProgramError::AccountDataTooSmall);
        }
        
        let size_bytes = (data_size as u32).to_le_bytes();
        data[..4].copy_from_slice(&size_bytes);
        data[Self::HEADER_SIZE..Self::HEADER_SIZE + data_size].copy_from_slice(&temp_buffer);
        
        Ok(())
    }
}

/// Instrukcje programu
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum SolanaIoInstruction {
    /// Tworzy nowy pokój gry
    CreateRoom {
        max_players: u8,
        entry_fee_lamports: u64,
        room_slot: u8,
        game_duration_minutes: u16,
        map_size: u16,
    },
    
    /// Dołącza do pokoju
    JoinRoom,
    
    /// Rozpoczyna grę
    StartGame {
        game_id: String,
    },
    
    /// Eliminuje gracza (wywoływane przez serwer)
    EliminatePlayer {
        player: Pubkey,
    },
    
    /// Kończy grę i ustala zwycięzcę
    EndGame {
        winner: Pubkey,
    },
    
    /// Odbiera nagrodę
    ClaimPrize,
    
    /// Anuluje pokój
    CancelRoom,
}

/// Przetwarzanie instrukcji programu
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    let instruction = SolanaIoInstruction::try_from_slice(input)?;
    
    match instruction {
        SolanaIoInstruction::CreateRoom { 
            max_players, 
            entry_fee_lamports, 
            room_slot,
            game_duration_minutes,
            map_size 
        } => {
            msg!("Creating Solana.io room");
            process_create_room(
                program_id, 
                accounts, 
                max_players, 
                entry_fee_lamports, 
                room_slot,
                game_duration_minutes,
                map_size
            )
        },
        SolanaIoInstruction::JoinRoom => {
            msg!("Joining room");
            process_join_room(program_id, accounts)
        },
        SolanaIoInstruction::StartGame { game_id } => {
            msg!("Starting game");
            process_start_game(program_id, accounts, game_id)
        },
        SolanaIoInstruction::EliminatePlayer { player } => {
            msg!("Eliminating player");
            process_eliminate_player(program_id, accounts, player)
        },
        SolanaIoInstruction::EndGame { winner } => {
            msg!("Ending game");
            process_end_game(program_id, accounts, winner)
        },
        SolanaIoInstruction::ClaimPrize => {
            msg!("Claiming prize");
            process_claim_prize(program_id, accounts)
        },
        SolanaIoInstruction::CancelRoom => {
            msg!("Canceling room");
            process_cancel_room(program_id, accounts)
        },
    }
}

fn process_create_room(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    max_players: u8,
    entry_fee_lamports: u64,
    room_slot: u8,
    game_duration_minutes: u16,
    map_size: u16,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let creator_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let rent_account = next_account_info(accounts_iter)?;
    
    if !creator_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Walidacja parametrów
    if max_players < 2 || max_players > 10 { // Zmniejszone z 20 do 10
        return Err(ProgramError::InvalidArgument);
    }
    
    if entry_fee_lamports == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    
    if room_slot >= 50 {
        return Err(ProgramError::InvalidArgument);
    }
    
    if game_duration_minutes < 5 || game_duration_minutes > 60 {
        return Err(ProgramError::InvalidArgument);
    }
    
    if map_size < 1000 || map_size > 10000 {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Weryfikacja PDA
    let (expected_game_pubkey, bump_seed) = Pubkey::find_program_address(
        &[b"solana_io", creator_account.key.as_ref(), &[room_slot]],
        program_id,
    );
    
    if expected_game_pubkey != *game_account.key {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Obliczenie czynszu
    let rent = Rent::from_account_info(rent_account)?;
    let space = GameRoom::SIZE;
    let lamports = rent.minimum_balance(space);
    
    // Utworzenie konta PDA
    invoke_signed(
        &system_instruction::create_account(
            creator_account.key,
            game_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            creator_account.clone(),
            game_account.clone(),
            system_program.clone(),
        ],
        &[&[b"solana_io", creator_account.key.as_ref(), &[room_slot], &[bump_seed]]],
    )?;
    
    // Transfer wpisowego
    invoke(
        &system_instruction::transfer(
            creator_account.key,
            game_account.key,
            entry_fee_lamports,
        ),
        &[
            creator_account.clone(),
            game_account.clone(),
            system_program.clone(),
        ],
    )?;
    
    // Inicjalizacja danych pokoju
    let clock = Clock::get()?;
    let game_room = GameRoom::new(
        *creator_account.key,
        max_players,
        entry_fee_lamports,
        clock.unix_timestamp,
        room_slot,
        game_duration_minutes,
        map_size,
    );
    
    game_room.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Created Solana.io room in slot {}", room_slot);
    Ok(())
}

fn process_join_room(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let player_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    
    if !player_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut game_room = GameRoom::from_account_data(&game_account.data.borrow())?;
    
    if game_room.status != GameStatus::WaitingForPlayers {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Sprawdź czy gracz już jest w pokoju
    for i in 0..game_room.player_count as usize {
        if game_room.players[i] == *player_account.key {
            return Err(ProgramError::InvalidArgument);
        }
    }
    
    // Sprawdź czy jest miejsce
    if game_room.player_count >= game_room.max_players {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Transfer wpisowego
    invoke(
        &system_instruction::transfer(
            player_account.key,
            game_account.key,
            game_room.entry_fee_lamports,
        ),
        &[
            player_account.clone(),
            game_account.clone(),
            system_program.clone(),
        ],
    )?;
    
    // Dodaj gracza używając metody add_player
    game_room.add_player(*player_account.key)?;
    game_room.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Player joined Solana.io room");
    Ok(())
}

fn process_start_game(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    game_id: String,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let initiator_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    
    if !initiator_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut game_room = GameRoom::from_account_data(&game_account.data.borrow())?;
    
    // Sprawdź czy inicjator jest w grze
    let mut is_player = false;
    for i in 0..game_room.player_count as usize {
        if game_room.players[i] == *initiator_account.key {
            is_player = true;
            break;
        }
    }
    
    if !is_player {
        return Err(ProgramError::InvalidArgument);
    }
    
    if game_room.status != GameStatus::WaitingForPlayers {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if game_room.player_count < 2 {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Ustawienie ID gry
    let game_id_bytes = game_id.as_bytes();
    let len = game_id_bytes.len().min(16);
    game_room.game_id[..len].copy_from_slice(&game_id_bytes[..len]);
    
    let clock = Clock::get()?;
    game_room.game_started_at = Some(clock.unix_timestamp);
    
    // WAŻNE: Zmień status gry na InProgress
    game_room.status = GameStatus::InProgress;
    
    game_room.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Solana.io game started");
    Ok(())
}

fn process_eliminate_player(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    player: Pubkey,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let authority_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    
    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut game_room = GameRoom::from_account_data(&game_account.data.borrow())?;
    
    // Sprawdź czy gra jest w toku
    if game_room.status != GameStatus::InProgress {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Sprawdź czy gracz jest w grze
    let mut player_found = false;
    for i in 0..game_room.player_count as usize {
        if game_room.players[i] == player {
            player_found = true;
            break;
        }
    }
    
    if !player_found {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Eliminuj gracza
    game_room.eliminate_player(player)?;
    
    // Sprawdź czy został tylko jeden gracz
    let active_players = game_room.count_active_players();
    if active_players == 1 {
        // Znajdź zwycięzcę
        if let Some(winner) = game_room.find_last_active_player() {
            game_room.winner = Some(winner);
            game_room.status = GameStatus::Completed;
            let clock = Clock::get()?;
            game_room.game_ended_at = Some(clock.unix_timestamp);
        }
    }
    
    game_room.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Player eliminated from Solana.io game");
    Ok(())
}

fn process_end_game(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    winner: Pubkey,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let initiator_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    
    if !initiator_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut game_room = GameRoom::from_account_data(&game_account.data.borrow())?;
    
    if game_room.status != GameStatus::InProgress {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Sprawdź czy zwycięzca jest w grze
    let mut winner_found = false;
    for i in 0..game_room.player_count as usize {
        if game_room.players[i] == winner {
            winner_found = true;
            break;
        }
    }
    
    if !winner_found {
        return Err(ProgramError::InvalidArgument);
    }
    
    game_room.status = GameStatus::Completed;
    game_room.winner = Some(winner);
    
    let clock = Clock::get()?;
    game_room.game_ended_at = Some(clock.unix_timestamp);
    
    game_room.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Solana.io game ended. Winner: {}", winner);
    Ok(())
}

fn process_claim_prize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let winner_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let _system_program = next_account_info(accounts_iter)?;
    let platform_fee_account = next_account_info(accounts_iter)?;
    
    const PLATFORM_WALLET: &str = "FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8";
    let platform_pubkey = Pubkey::try_from(PLATFORM_WALLET).unwrap();
    
    if *platform_fee_account.key != platform_pubkey {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !winner_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if game_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    
    let mut game_room = GameRoom::from_account_data(&game_account.data.borrow())?;
    
    if game_room.status != GameStatus::Completed {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if game_room.winner != Some(*winner_account.key) {
        return Err(ProgramError::InvalidArgument);
    }
    
    if game_room.prize_claimed {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Obliczenie puli i prowizji
    let total_prize = game_room.entry_fee_lamports * game_room.player_count as u64;
    let platform_fee = total_prize * 5 / 100; // 5% prowizji
    let winner_prize = total_prize - platform_fee;
    
    // Transfer prowizji
    if platform_fee > 0 {
        **game_account.try_borrow_mut_lamports()? = 
            game_account.lamports().saturating_sub(platform_fee);
        **platform_fee_account.try_borrow_mut_lamports()? = 
            platform_fee_account.lamports().saturating_add(platform_fee);
    }
    
    // Transfer nagrody
    **game_account.try_borrow_mut_lamports()? = 
        game_account.lamports().saturating_sub(winner_prize);
    **winner_account.try_borrow_mut_lamports()? = 
        winner_account.lamports().saturating_add(winner_prize);
    
    game_room.prize_claimed = true;
    game_room.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Prize claimed. Platform fee: {} lamports, Winner prize: {} lamports", 
         platform_fee, winner_prize);
    Ok(())
}

fn process_cancel_room(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let creator_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    
    if !creator_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let game_room = GameRoom::from_account_data(&game_account.data.borrow())?;
    
    if game_room.creator != *creator_account.key {
        return Err(ProgramError::InvalidArgument);
    }
    
    if game_room.status != GameStatus::WaitingForPlayers {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Sygnatury PDA
    let seeds = &[b"solana_io", game_room.creator.as_ref(), &[game_room.room_slot]];
    let (_, bump_seed) = Pubkey::find_program_address(seeds, program_id);
    let signer_seeds = &[b"solana_io", game_room.creator.as_ref(), &[game_room.room_slot], &[bump_seed]];
    
    // Zwrot wpisowego każdemu graczowi
    let mut remaining_accounts_iter = accounts_iter.clone();
    for i in 0..game_room.player_count as usize {
        let player_pubkey = &game_room.players[i];
        if *player_pubkey != game_room.creator {
            let player_account = next_account_info(&mut remaining_accounts_iter)?;
            
            if *player_account.key != *player_pubkey {
                return Err(ProgramError::InvalidArgument);
            }
            
            invoke_signed(
                &system_instruction::transfer(
                    game_account.key,
                    player_account.key,
                    game_room.entry_fee_lamports,
                ),
                &[
                    game_account.clone(),
                    player_account.clone(),
                    system_program.clone(),
                ],
                &[signer_seeds],
            )?;
        }
    }
    
    // Zwróć resztę do twórcy
    let remaining_lamports = game_account.lamports();
    **game_account.lamports.borrow_mut() = 0;
    **creator_account.lamports.borrow_mut() += remaining_lamports;
    
    msg!("Solana.io room cancelled");
    Ok(())
}