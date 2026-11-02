//! BlindMark NEAR contract. Spec: CLAUDE.md section 7.

use near_sdk::{AccountId, PanicOnDefault, near};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct BlindMark {
    admin: AccountId,
    outlayer_contract: AccountId,
    platform_fee_bps: u16,
    treasury: AccountId,
    next_benchmark_id: u64,
    next_eval_id: u64,
}

#[near]
impl BlindMark {
    #[init]
    pub fn new(
        admin: AccountId,
        outlayer_contract: AccountId,
        treasury: AccountId,
        platform_fee_bps: u16,
    ) -> Self {
        Self {
            admin,
            outlayer_contract,
            platform_fee_bps,
            treasury,
            next_benchmark_id: 0,
            next_eval_id: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_stores_config() {
        let admin: AccountId = "admin.testnet".parse().unwrap();
        let outlayer: AccountId = "outlayer.testnet".parse().unwrap();
        let treasury: AccountId = "treasury.testnet".parse().unwrap();

        let contract = BlindMark::new(admin.clone(), outlayer.clone(), treasury.clone(), 500);

        assert_eq!(contract.admin, admin);
        assert_eq!(contract.outlayer_contract, outlayer);
        assert_eq!(contract.treasury, treasury);
        assert_eq!(contract.platform_fee_bps, 500);
    }
}
