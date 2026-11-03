"use client";

import type { ModuleState } from "@near-wallet-selector/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CONTRACT_ID, NETWORK_ID } from "../lib/config";

/**
 * Browser extensions, keyed by Wallet Selector module id, with the global each one injects
 * (taken from that module's own source). The modules' `available` flag cannot be used for
 * this: MyNearWallet and Nightly always report true. Every other module is a web wallet.
 */
const EXTENSIONS: Record<string, () => boolean> = {
  sender: () => Boolean(injected().near?.isSender),
  "okx-wallet": () => Boolean(injected().okxwallet),
  "bitget-wallet": () => Boolean(injected().bitkeep?.near),
  nightly: () => Boolean(injected().nightly),
};

function injected(): {
  near?: { isSender?: unknown };
  okxwallet?: unknown;
  bitkeep?: { near?: unknown };
  nightly?: unknown;
} {
  return window as never;
}

type Kind = "detected" | "web" | "install";

function kind(module: ModuleState): Kind {
  const detect = EXTENSIONS[module.id];
  if (!detect) return "web";
  return detect() ? "detected" : "install";
}

function downloadUrl(module: ModuleState): string | null {
  const url = (module.metadata as { downloadUrl?: unknown }).downloadUrl;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/** Native <dialog> shell: focus trap, Escape and backdrop click close it. */
function Dialog({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Start on the first choice rather than the close button. React's autoFocus runs at
      // mount, before the dialog opens, so it cannot do this.
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="bm-wallet"
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bm-wallet-body">
        <button
          type="button"
          className="bm-wallet-close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2 2l10 10M12 2L2 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className="bm-wallet-badge" aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2" />
            <rect x="4" y="7.5" width="16" height="11.5" rx="2.5" />
            <path d="M16 13.25h.01" strokeWidth="2.4" />
          </svg>
        </span>
        {children}
      </div>
    </dialog>
  );
}

/**
 * Wallet picker. Lists only the browser extension wallets detected in this browser; the
 * ones not found are offered as install links. Shows only
 * wallet names and errors; never logs keys or account data.
 */
export function WalletModal({
  open,
  modules,
  onClose,
}: {
  open: boolean;
  modules: ModuleState[];
  onClose: () => void;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Closing by any route (close button, Escape, backdrop, a finished sign-in) clears the
  // last error, so the picker always reopens clean.
  function close() {
    setError(null);
    onClose();
  }

  // Only extensions found in this browser are offered. Web wallets (Intear, MyNearWallet)
  // have nothing to detect, so they are not listed; they stay registered in wallet.tsx so
  // an existing session with them still restores.
  const ready = modules
    .filter((m) => kind(m) === "detected")
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  const install = modules.filter(
    (m) => kind(m) === "install" && downloadUrl(m) !== null,
  );
  const detected = ready.length > 0;

  async function connect(module: ModuleState) {
    setError(null);
    setConnecting(module.id);
    try {
      const wallet = await module.wallet();
      // Hardware wallets need an account list first; none are registered in wallet.tsx.
      if (wallet.type === "hardware")
        throw new Error("hardware wallets are not supported here");
      // Web wallets redirect away here; extensions resolve once the person approves.
      await wallet.signIn({ contractId: CONTRACT_ID, methodNames: [] });
      close();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`${module.metadata.name} did not connect: ${message}`);
    } finally {
      setConnecting(null);
    }
  }

  return (
    <Dialog open={open} onClose={close} labelledBy="bm-wallet-title">
      <div className="bm-wallet-head">
        <h2 id="bm-wallet-title">Connect your wallet</h2>
        <p>
          Choose a NEAR wallet to request evaluations or register benchmarks.
        </p>
      </div>

      {error && (
        <p className="bm-wallet-error" role="alert">
          {error}
        </p>
      )}

      <ul className="bm-wallet-list">
        {ready.map((module, i) => (
          <li key={module.id}>
            <button
              type="button"
              data-autofocus={i === 0 ? "" : undefined}
              className="bm-wallet-row"
              aria-busy={connecting === module.id}
              disabled={connecting !== null}
              onClick={() => void connect(module)}
            >
              {/* Icons are data URIs shipped in the wallet modules: nothing to optimize or fetch. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={module.metadata.iconUrl}
                alt=""
                width={36}
                height={36}
              />
              <span className="bm-wallet-name">{module.metadata.name}</span>
              {connecting === module.id ? (
                <span className="bm-wallet-spinner" aria-label="Connecting" />
              ) : (
                <span className="bm-wallet-state">Detected</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {!detected && (
        <p className="bm-wallet-empty">
          No NEAR wallet extension detected. Install one below, then come back
          here to connect.
        </p>
      )}

      {install.length > 0 && (
        <div className="bm-wallet-more">
          <p>{detected ? "Other wallets" : "Get a wallet"}</p>
          <ul>
            {install.map((module) => (
              <li key={module.id}>
                <a
                  href={downloadUrl(module) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={module.metadata.iconUrl}
                    alt=""
                    width={28}
                    height={28}
                  />
                  <span>{module.metadata.name}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 17L17 7M8 7h9v9" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="bm-wallet-foot">
        NEAR {NETWORK_ID}
        {NETWORK_ID === "testnet" ? " · test funds only" : ""}. Signs in to{" "}
        <code>{CONTRACT_ID}</code>.
      </p>
    </Dialog>
  );
}

/** Shortens long implicit account ids (64 hex chars); named accounts stay readable. */
export function shortAccount(accountId: string): string {
  return accountId.length > 24
    ? `${accountId.slice(0, 6)}…${accountId.slice(-6)}`
    : accountId;
}

/** Connected-account dialog: shows the account and offers to change wallet or disconnect. */
export function AccountModal({
  open,
  accountId,
  walletName,
  onClose,
  onChange,
  onDisconnect,
}: {
  open: boolean;
  accountId: string;
  walletName: string | null;
  onClose: () => void;
  onChange: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="bm-account-title">
      <div className="bm-wallet-head">
        <h2 id="bm-account-title">{walletName ?? "Connected wallet"}</h2>
        <p>
          NEAR {NETWORK_ID}. This account signs your evaluation requests and
          benchmark registrations.
        </p>
      </div>
      <p className="bm-account-id">
        <code>{accountId}</code>
      </p>
      {error && (
        <p className="bm-wallet-error" role="alert">
          {error}
        </p>
      )}
      <div className="bm-account-actions">
        <button type="button" className="secondary" onClick={onChange}>
          Change wallet
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            onDisconnect()
              .then(onClose)
              .catch((e: unknown) =>
                setError(
                  `Could not disconnect: ${e instanceof Error ? e.message : String(e)}`,
                ),
              );
          }}
        >
          Disconnect
        </button>
      </div>
    </Dialog>
  );
}
