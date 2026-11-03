import "./globals.css";
import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "../components/icons";
import { WalletButton, WalletProvider } from "../components/wallet";
import { CONTRACT_ID, NETWORK_ID } from "../lib/config";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "BlindMark",
  description: "Private AI benchmarks with public certificates on NEAR.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          {NETWORK_ID === "testnet" && (
            <div className="announce">
              Running on NEAR testnet. Every certificate below is a real
              on-chain record you can verify.
            </div>
          )}
          <header className="site">
            <Link href="/" className="brand">
              <Mark />
              BlindMark
            </Link>
            <nav>
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/benchmarks/new">Register benchmark</Link>
              <Link href="/#verify">Verify</Link>
            </nav>
            <div className="site-actions">
              <span className="network mono" title={CONTRACT_ID}>
                <span className="dot" />
                {NETWORK_ID}
              </span>
              <WalletButton />
            </div>
          </header>
          {children}
          <footer className="site">
            <span>BlindMark</span>
            <span className="mono">{CONTRACT_ID}</span>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
