"use client";

import type { ModuleState, WalletSelector } from "@near-wallet-selector/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CONTRACT_ID, NETWORK_ID } from "../lib/config";
import { AccountModal, shortAccount, WalletModal } from "./wallet-modal";

const TGAS = 10n ** 12n;

interface CallOptions {
  deposit?: bigint;
  tgas?: number;
  /** Defaults to the BlindMark contract. */
  receiverId?: string;
  /** Raw arguments (for example Borsh bytes) instead of JSON. */
  rawArgs?: Uint8Array;
}

export interface FunctionCallTx {
  receiverId: string;
  method: string;
  args: object | Uint8Array;
  deposit?: bigint;
  tgas?: number;
}

interface WalletContextValue {
  ready: boolean;
  accountId: string | null;
  /** Opens the wallet picker. */
  signIn: () => void;
  /** Opens the connected-account dialog (change wallet, disconnect). */
  openAccount: () => void;
  signOut: () => Promise<void>;
  /**
   * Signs and sends one function call to the BlindMark contract and resolves with the wallet's
   * outcome, if it returns one. Wallets wait for final execution, which `request_eval` and
   * `continue_dispatch` may never reach before the wallet times out, so callers of those two
   * must follow progress through `get_eval` and never retry the call automatically.
   */
  call: (
    method: string,
    args: object,
    options?: CallOptions,
  ) => Promise<unknown>;
  /**
   * Signs and sends several single-call transactions with one wallet approval where the wallet
   * supports it. Resolves with the wallet's outcomes; rejects if the wallet refuses or reports a
   * failed transaction.
   */
  sendTransactions: (txs: FunctionCallTx[]) => Promise<unknown[]>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      // Browser extension wallets are detected through their injected providers; the picker
      // lists the ones found and offers install links for the rest. Meteor is left out: its SDK needs near-api-js 6, and
      // this repo uses 7. HOT is left out: its SDK pulls in Solana and wallet selector 8.
      const [
        { setupWalletSelector },
        sender,
        okx,
        bitget,
        nightly,
        intear,
        mnw,
      ] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/sender"),
        import("@near-wallet-selector/okx-wallet"),
        import("@near-wallet-selector/bitget-wallet"),
        import("@near-wallet-selector/nightly"),
        import("@near-wallet-selector/intear-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
      ]);
      const instance = await setupWalletSelector({
        network: NETWORK_ID,
        modules: [
          sender.setupSender(),
          okx.setupOKXWallet(),
          bitget.setupBitgetWallet(),
          nightly.setupNightly(),
          intear.setupIntearWallet(),
          mnw.setupMyNearWallet(),
        ],
      });
      if (cancelled) return;
      const subscription = instance.store.observable.subscribe((state) => {
        setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
        setModules(state.modules);
        setWalletId(state.selectedWalletId);
      });
      unsubscribe = () => subscription.unsubscribe();
      setSelector(instance);
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(() => setPickerOpen(true), []);

  const signOut = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
  }, [selector]);

  const call = useCallback(
    async (
      method: string,
      args: object,
      {
        deposit = 0n,
        tgas = 100,
        receiverId = CONTRACT_ID,
        rawArgs,
      }: CallOptions = {},
    ) => {
      if (!selector || !accountId) throw new Error("connect a wallet first");
      const { actionCreators } = await import("@near-wallet-selector/core");
      const wallet = await selector.wallet();
      return wallet.signAndSendTransaction({
        receiverId,
        actions: [
          actionCreators.functionCall(
            method,
            rawArgs ?? args,
            BigInt(tgas) * TGAS,
            deposit,
          ),
        ],
      });
    },
    [selector, accountId],
  );

  const sendTransactions = useCallback(
    async (txs: FunctionCallTx[]) => {
      if (!selector || !accountId) throw new Error("connect a wallet first");
      const { actionCreators } = await import("@near-wallet-selector/core");
      const wallet = await selector.wallet();
      const outcomes = await wallet.signAndSendTransactions({
        transactions: txs.map((tx) => ({
          receiverId: tx.receiverId,
          actions: [
            actionCreators.functionCall(
              tx.method,
              tx.args,
              BigInt(tx.tgas ?? 30) * TGAS,
              tx.deposit ?? 0n,
            ),
          ],
        })),
      });
      return (outcomes ?? []) as unknown[];
    },
    [selector, accountId],
  );

  return (
    <WalletContext.Provider
      value={{
        ready: selector !== null,
        accountId,
        signIn,
        openAccount: () => setAccountOpen(true),
        signOut,
        call,
        sendTransactions,
      }}
    >
      {children}
      {/* Client only: the selector loads after hydration, and detection reads `window`. */}
      {selector && (
        <WalletModal
          open={pickerOpen}
          modules={modules}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {selector && accountId && (
        <AccountModal
          open={accountOpen}
          accountId={accountId}
          walletName={
            modules.find((m) => m.id === walletId)?.metadata.name ?? null
          }
          onClose={() => setAccountOpen(false)}
          onChange={() => {
            setAccountOpen(false);
            setPickerOpen(true);
          }}
          onDisconnect={signOut}
        />
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet needs WalletProvider");
  return value;
}

export function WalletButton() {
  const { ready, accountId, signIn, openAccount } = useWallet();
  if (!ready) return <button disabled>Loading wallets</button>;
  if (!accountId) return <button onClick={signIn}>Connect wallet</button>;
  return (
    <button
      className="secondary account-button"
      onClick={openAccount}
      title={accountId}
    >
      <span className="dot" aria-hidden="true" />
      <span className="mono">{shortAccount(accountId)}</span>
    </button>
  );
}

/** Pulls the contract's return value out of a wallet outcome, if the wallet gave one. */
export function returnValue(outcome: unknown): unknown {
  const status = (outcome as { status?: { SuccessValue?: string } } | undefined)
    ?.status;
  if (typeof status?.SuccessValue !== "string") return undefined;
  try {
    return JSON.parse(atob(status.SuccessValue));
  } catch {
    return undefined;
  }
}
