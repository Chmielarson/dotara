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

/// Struktura gracza w grze
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct PlayerState {
    pub pubkey: Pubkey,              // 32 bajty - adres gracza
    pub stake_amount: u64,           // 8 bajtów - ile SOL wniósł
    pub current_value: u64,          // 8 bajtów - aktualna wartość w lamports
    pub is_active: bool,             // 1 bajt - czy gracz jest aktywny
    pub joined_at: i64,              // 8 bajtów - timestamp dołączenia
    pub last_cashout: i64,           // 8 bajtów - ostatnia wypłata
    pub total_earned: u64,           // 8 bajtów - łączne zarobki
}

impl PlayerState {
    pub const SIZE: usize = 32 + 8 + 8 + 1 + 8 + 8 + 8; // 73 bajty
}

/// Globalna gra - pojedyncza instancja
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GlobalGame {
    pub is_initialized: bool,        // 1 bajt
    pub total_pool: u64,            // 8 bajtów - całkowita pula
    pub platform_fee_collected: u64, // 8 bajtów - zebrane prowizje
    pub active_players: u32,         // 4 bajty - liczba aktywnych graczy
    pub total_players: u32,          // 4 bajty - wszyscy gracze
    pub created_at: i64,            // 8 bajtów
    pub min_stake: u64,             // 8 bajtów - minimalna stawka
    pub max_stake: u64,             // 8 bajtów - maksymalna stawka
    pub platform_fee_percent: u8,    // 1 bajt - procent prowizji
    pub server_authority: Pubkey,    // 32 bajty - adres serwera z uprawnieniami
}

impl GlobalGame {
    pub const SIZE: usize = 256; // Rozmiar z dodatkowym polem
    pub const HEADER_SIZE: usize = 4;
    pub const MAX_PLAYERS: usize = 1000; // Maksymalna liczba graczy
    
    pub fn new(created_at: i64, server_authority: Pubkey) -> Self {
        Self {
            is_initialized: true,
            total_pool: 0,
            platform_fee_collected: 0,
            active_players: 0,
            total_players: 0,
            created_at,
            min_stake: 50_000_000,     // ZMIANA: 0.05 SOL minimum
            max_stake: 10_000_000_000, // 10 SOL maximum
            platform_fee_percent: 5,   // 5% prowizji
            server_authority,          // Zapisz adres serwera
        }
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
    /// Inicjalizuje globalną grę (tylko raz)
    InitializeGame {
        server_authority: Pubkey, // Adres serwera z uprawnieniami
    },
    
    /// Gracz dołącza do gry z określoną stawką
    JoinGame {
        stake_amount: u64,
    },
    
    /// Aktualizuje wartość gracza po zjedzeniu innego gracza
    UpdatePlayerValue {
        player: Pubkey,
        eaten_player: Pubkey,
        eaten_value: u64,
    },
    
    /// Gracz wypłaca swoje środki i opuszcza grę
    CashOut,
    
    /// Admin może zaktualizować parametry gry
    UpdateGameParams {
        min_stake: Option<u64>,
        max_stake: Option<u64>,
        platform_fee_percent: Option<u8>,
        new_server_authority: Option<Pubkey>,
    },
    
    /// Server authority może wymusić czyszczenie stanu gracza (bez wypłaty)
    ForceCleanup {
        player: Pubkey,
    },
}

/// Przetwarzanie instrukcji programu
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    let instruction = SolanaIoInstruction::try_from_slice(input)?;
    
    match instruction {
        SolanaIoInstruction::InitializeGame { server_authority } => {
            msg!("Initializing Solana.io global game with server authority: {}", server_authority);
            process_initialize_game(program_id, accounts, server_authority)
        },
        SolanaIoInstruction::JoinGame { stake_amount } => {
            msg!("Player joining game with stake: {} lamports", stake_amount);
            process_join_game(program_id, accounts, stake_amount)
        },
        SolanaIoInstruction::UpdatePlayerValue { player, eaten_player, eaten_value } => {
            msg!("Updating player value after eating");
            process_update_player_value(program_id, accounts, player, eaten_player, eaten_value)
        },
        SolanaIoInstruction::CashOut => {
            msg!("Player cashing out");
            process_cash_out(program_id, accounts)
        },
        SolanaIoInstruction::UpdateGameParams { min_stake, max_stake, platform_fee_percent, new_server_authority } => {
            msg!("Updating game parameters");
            process_update_game_params(program_id, accounts, min_stake, max_stake, platform_fee_percent, new_server_authority)
        },
        SolanaIoInstruction::ForceCleanup { player } => {
            msg!("Server forcing cleanup for player: {}", player);
            process_force_cleanup(program_id, accounts, player)
        },
    }
}

fn process_initialize_game(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    server_authority: Pubkey,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let initializer = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let rent_account = next_account_info(accounts_iter)?;
    
    if !initializer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Weryfikacja PDA dla globalnej gry
    let (expected_game_pubkey, bump_seed) = Pubkey::find_program_address(
        &[b"global_game"],
        program_id,
    );
    
    if expected_game_pubkey != *game_account.key {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Sprawdź czy gra już jest zainicjalizowana
    if !game_account.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    
    // Oblicz czynsz
    let rent = Rent::from_account_info(rent_account)?;
    let space = GlobalGame::SIZE;
    let lamports = rent.minimum_balance(space);
    
    // Utwórz konto PDA dla gry
    invoke_signed(
        &system_instruction::create_account(
            initializer.key,
            game_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            initializer.clone(),
            game_account.clone(),
            system_program.clone(),
        ],
        &[&[b"global_game".as_ref(), &[bump_seed]]],
    )?;
    
    // Inicjalizuj dane gry z server authority
    let clock = Clock::get()?;
    let game = GlobalGame::new(clock.unix_timestamp, server_authority);
    
    game.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Global game initialized successfully with server authority: {}", server_authority);
    Ok(())
}

fn process_join_game(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    stake_amount: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let player_account = next_account_info(accounts_iter)?;
    let player_state_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let rent_account = next_account_info(accounts_iter)?;
    
    if !player_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Załaduj dane gry
    let mut game = GlobalGame::from_account_data(&game_account.data.borrow())?;
    
    // Walidacja stawki
    if stake_amount < game.min_stake || stake_amount > game.max_stake {
        msg!("Invalid stake amount: {} (min: {}, max: {})", 
             stake_amount, game.min_stake, game.max_stake);
        return Err(ProgramError::InvalidArgument);
    }
    
    // Weryfikacja PDA dla stanu gracza
    let (expected_player_state_pubkey, bump_seed) = Pubkey::find_program_address(
        &[b"player_state", player_account.key.as_ref()],
        program_id,
    );
    
    if expected_player_state_pubkey != *player_state_account.key {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Sprawdź czy gracz już ma konto
    let mut is_rejoining = false;
    let mut existing_value = 0u64;
    
    if !player_state_account.data_is_empty() {
        // Gracz już ma konto - sprawdź stan
        let mut player_state = PlayerState::try_from_slice(&player_state_account.data.borrow())?;
        
        if player_state.is_active {
            msg!("Player is already active in the game");
            return Err(ProgramError::AccountAlreadyInitialized);
        }
        
        // Gracz może ponownie dołączyć
        is_rejoining = true;
        existing_value = player_state.current_value;
        
        // Aktualizuj stan gracza
        player_state.is_active = true;
        player_state.stake_amount += stake_amount;
        player_state.current_value += stake_amount;
        player_state.joined_at = Clock::get()?.unix_timestamp;
        
        // Zapisz zaktualizowany stan
        player_state.serialize(&mut &mut player_state_account.data.borrow_mut()[..])?;
    } else {
        // Nowy gracz - utwórz konto
        let rent = Rent::from_account_info(rent_account)?;
        let space = PlayerState::SIZE;
        let lamports = rent.minimum_balance(space);
        
        invoke_signed(
            &system_instruction::create_account(
                player_account.key,
                player_state_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                player_account.clone(),
                player_state_account.clone(),
                system_program.clone(),
            ],
            &[&[b"player_state".as_ref(), player_account.key.as_ref(), &[bump_seed]]],
        )?;
        
        // Utwórz nowy stan gracza
        let player_state = PlayerState {
            pubkey: *player_account.key,
            stake_amount,
            current_value: stake_amount,
            is_active: true,
            joined_at: Clock::get()?.unix_timestamp,
            last_cashout: 0,
            total_earned: 0,
        };
        
        player_state.serialize(&mut &mut player_state_account.data.borrow_mut()[..])?;
    }
    
    // Transfer stawki do puli gry
    invoke(
        &system_instruction::transfer(
            player_account.key,
            game_account.key,
            stake_amount,
        ),
        &[
            player_account.clone(),
            game_account.clone(),
            system_program.clone(),
        ],
    )?;
    
    // Zaktualizuj dane gry
    game.total_pool += stake_amount;
    if !is_rejoining {
        game.active_players += 1;
        game.total_players += 1;
    } else {
        game.active_players += 1;
        msg!("Player rejoining with existing value: {} + new stake: {} = total: {}", 
             existing_value, stake_amount, existing_value + stake_amount);
    }
    
    game.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Player {} {} with stake: {} lamports", 
         player_account.key, 
         if is_rejoining { "rejoined" } else { "joined" },
         stake_amount);
    Ok(())
}

fn process_update_player_value(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _player: Pubkey,
    _eaten_player: Pubkey,
    eaten_value: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let authority_account = next_account_info(accounts_iter)?;
    let player_state_account = next_account_info(accounts_iter)?;
    let eaten_player_state_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    
    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Załaduj grę i sprawdź czy to autoryzowany serwer
    let game = GlobalGame::from_account_data(&game_account.data.borrow())?;
    
    // Weryfikacja authority - tylko zapisany serwer może aktualizować
    if *authority_account.key != game.server_authority {
        msg!("Unauthorized: Only server authority can update player values");
        msg!("Expected: {}, Got: {}", game.server_authority, authority_account.key);
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Załaduj stany graczy
    let mut player_state = PlayerState::try_from_slice(&player_state_account.data.borrow())?;
    let mut eaten_player_state = PlayerState::try_from_slice(&eaten_player_state_account.data.borrow())?;
    
    if !player_state.is_active || !eaten_player_state.is_active {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Transfer wartości - WAŻNE: dodaj wartość do gracza który zjadł
    player_state.current_value += eaten_value;
    eaten_player_state.current_value = 0;
    eaten_player_state.is_active = false;
    
    msg!("Player gained {} lamports from eating. New value: {} lamports", 
         eaten_value, player_state.current_value);
    
    // Zapisz zmiany
    player_state.serialize(&mut &mut player_state_account.data.borrow_mut()[..])?;
    eaten_player_state.serialize(&mut &mut eaten_player_state_account.data.borrow_mut()[..])?;
    
    // Zaktualizuj liczbę aktywnych graczy
    let mut game = GlobalGame::from_account_data(&game_account.data.borrow())?;
    game.active_players = game.active_players.saturating_sub(1);
    game.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Player value updated successfully by authorized server");
    Ok(())
}

fn process_cash_out(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let player_account = next_account_info(accounts_iter)?;
    let player_state_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let platform_fee_account = next_account_info(accounts_iter)?;
    
    const PLATFORM_WALLET: &str = "FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8";
    let platform_pubkey = Pubkey::try_from(PLATFORM_WALLET).unwrap();
    
    if *platform_fee_account.key != platform_pubkey {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !player_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Załaduj stan gracza
    let mut player_state = PlayerState::try_from_slice(&player_state_account.data.borrow())?;
    
    if !player_state.is_active {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if player_state.current_value == 0 {
        return Err(ProgramError::InsufficientFunds);
    }
    
    // Załaduj grę
    let mut game = GlobalGame::from_account_data(&game_account.data.borrow())?;
    
    // Oblicz prowizję
    let platform_fee = player_state.current_value * game.platform_fee_percent as u64 / 100;
    let player_payout = player_state.current_value - platform_fee;
    
    // Transfer prowizji
    if platform_fee > 0 {
        **game_account.try_borrow_mut_lamports()? = 
            game_account.lamports().saturating_sub(platform_fee);
        **platform_fee_account.try_borrow_mut_lamports()? = 
            platform_fee_account.lamports().saturating_add(platform_fee);
    }
    
    // Transfer wypłaty do gracza
    **game_account.try_borrow_mut_lamports()? = 
        game_account.lamports().saturating_sub(player_payout);
    **player_account.try_borrow_mut_lamports()? = 
        player_account.lamports().saturating_add(player_payout);
    
    // Zaktualizuj stan gracza
    let clock = Clock::get()?;
    player_state.is_active = false;
    player_state.last_cashout = clock.unix_timestamp;
    player_state.total_earned += player_payout;
    let final_value = player_state.current_value;
    player_state.current_value = 0;
    
    player_state.serialize(&mut &mut player_state_account.data.borrow_mut()[..])?;
    
    // Zaktualizuj grę
    game.total_pool = game.total_pool.saturating_sub(final_value);
    game.active_players = game.active_players.saturating_sub(1);
    game.platform_fee_collected += platform_fee;
    
    game.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Player cashed out: {} lamports (fee: {} lamports)", player_payout, platform_fee);
    Ok(())
}

fn process_update_game_params(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    min_stake: Option<u64>,
    max_stake: Option<u64>,
    platform_fee_percent: Option<u8>,
    new_server_authority: Option<Pubkey>,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let admin_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    
    if !admin_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut game = GlobalGame::from_account_data(&game_account.data.borrow())?;
    
    // Tylko server authority może aktualizować parametry
    if *admin_account.key != game.server_authority {
        msg!("Unauthorized: Only server authority can update game params");
        return Err(ProgramError::InvalidAccountData);
    }
    
    if let Some(min) = min_stake {
        game.min_stake = min;
    }
    
    if let Some(max) = max_stake {
        game.max_stake = max;
    }
    
    if let Some(fee) = platform_fee_percent {
        if fee > 10 { // Maksymalnie 10% prowizji
            return Err(ProgramError::InvalidArgument);
        }
        game.platform_fee_percent = fee;
    }
    
    if let Some(new_authority) = new_server_authority {
        game.server_authority = new_authority;
        msg!("Server authority updated to: {}", new_authority);
    }
    
    game.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Game parameters updated");
    Ok(())
}

// NOWA FUNKCJA: Force cleanup przez server authority (bez wypłaty!)
fn process_force_cleanup(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    player_pubkey: Pubkey,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    let authority_account = next_account_info(accounts_iter)?;
    let player_state_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let platform_fee_account = next_account_info(accounts_iter)?;
    let player_account = next_account_info(accounts_iter)?;
    
    const PLATFORM_WALLET: &str = "FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8";
    let platform_pubkey = Pubkey::try_from(PLATFORM_WALLET).unwrap();
    
    if *platform_fee_account.key != platform_pubkey {
        return Err(ProgramError::InvalidArgument);
    }
    
    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Załaduj grę i sprawdź authority
    let mut game = GlobalGame::from_account_data(&game_account.data.borrow())?;
    
    if *authority_account.key != game.server_authority {
        msg!("Unauthorized: Only server authority can force cash out");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Sprawdź czy player account jest poprawny
    if *player_account.key != player_pubkey {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Sprawdź PDA gracza
    let (expected_player_state_pubkey, _) = Pubkey::find_program_address(
        &[b"player_state", player_pubkey.as_ref()],
        program_id,
    );
    
    if expected_player_state_pubkey != *player_state_account.key {
        return Err(ProgramError::InvalidArgument);
    }
    
    // Załaduj stan gracza
    let mut player_state = PlayerState::try_from_slice(&player_state_account.data.borrow())?;
    
    // WAŻNE: Force cash out TYLKO czyści stan - NIE wypłaca pieniędzy!
    // To jest tylko do usuwania "ghost" graczy z blockchain
    
    if !player_state.is_active {
        msg!("Player is not active, no need to force cleanup");
        return Ok(());
    }
    
    // Loguj ile gracz miał wartości (dla debugowania)
    msg!("Force cleanup: Player {} had {} lamports", 
         player_pubkey, player_state.current_value);
    
    // WAŻNE: NIE wypłacamy graczowi żadnych środków!
    // Jeśli gracz miał wartość > 0, to znaczy że:
    // 1. Został zjedzony (wartość przeszła do innego gracza)
    // 2. Lub jest to błąd synchronizacji
    
    // Tylko aktualizujemy stan gracza jako nieaktywny
    let clock = Clock::get()?;
    player_state.is_active = false;
    player_state.last_cashout = clock.unix_timestamp;
    // NIE dodajemy do total_earned bo to nie jest prawdziwy cash out
    // Ustawiamy current_value na 0 bez wypłaty
    let lost_value = player_state.current_value;
    player_state.current_value = 0;
    
    player_state.serialize(&mut &mut player_state_account.data.borrow_mut()[..])?;
    
    // Aktualizuj grę - zmniejsz liczbę aktywnych graczy
    game.active_players = game.active_players.saturating_sub(1);
    
    // WAŻNE: NIE odejmujemy z total_pool bo te środki już zostały przeniesione
    // (gracz został zjedzony lub cash out był już wykonany)
    
    game.to_account_data(&mut game_account.data.borrow_mut())?;
    
    msg!("Server forced cleanup for ghost player {} (lost {} lamports)", 
         player_pubkey, lost_value);
    Ok(())
}