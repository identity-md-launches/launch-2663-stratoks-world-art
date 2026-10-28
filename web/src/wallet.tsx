import {
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
} from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";
import { coinbaseWallet } from "wagmi/connectors/coinbaseWallet";
import { useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { Modal } from "./Modal";
import { Icon } from "./icons";
import { connection } from "./service";
import { shortAddress } from "./format";
import type { Session } from "./types";
// The application performs signature-only account authentication. There are no chain reads or transactions.
// mainnet is connector metadata; EIP-191 sign-in is intentionally independent of a selected network.
export const walletConfig = createConfig({
  chains: [mainnet],
  multiInjectedProviderDiscovery: true,
  connectors: [
    injected(),
    coinbaseWallet({
      appName: "Stratoks",
      appLogoUrl: new URL("./favicon.svg", location.href).href,
    }),
  ],
  transports: { [mainnet.id]: http() },
});
const OPEN_IN = [
  {
    id: "metamask",
    name: "MetaMask",
    href: (url: string) =>
      `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    href: (url: string) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "rabby",
    name: "Rabby",
    href: (url: string) =>
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}`,
  },
  {
    id: "phantom",
    name: "Phantom",
    href: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];
export function WalletControl({
  onSession,
  serviceConnected,
}: {
  onSession: (session: Session | null) => void;
  serviceConnected: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const accountRef = useRef(address);
  accountRef.current = address;
  const serviceRef = useRef(serviceConnected);
  serviceRef.current = serviceConnected;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(window as any).ethereum;
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter((c) => !(c.id === "injected" && named));
  useEffect(() => {
    connection.session = null;
    setSession(null);
    onSession(null);
    setError("");
  }, [address, serviceConnected, onSession]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        connection.session = null;
        setSession(null);
        onSession(null);
      },
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session, onSession]);
  async function signIn() {
    if (!address) return;
    setSigning(true);
    setError("");
    try {
      const challenge = await connection.request<{
        message: string;
        nonce: string;
        expiresAt: number;
      }>("/api/auth/nonce", { address });
      // Verify what this page will ask the wallet to sign before opening the wallet prompt.
      if (
        !challenge.message.includes(`\nOrigin: ${location.origin}\n`) ||
        !challenge.message.includes(`\nAddress: ${address.toLowerCase()}\n`) ||
        challenge.expiresAt <= Date.now() ||
        !challenge.message.includes(`\nNonce: ${challenge.nonce}\n`)
      )
        throw new Error("The server supplied a mismatched sign-in challenge.");
      const signature = await signMessageAsync({ message: challenge.message });
      if (signature.length !== 132)
        throw new Error(
          "Smart-account sign-in is not supported by this server yet. Use a browser wallet or Coinbase mobile wallet.",
        );
      const result = await connection.request<Session>("/api/auth/verify", {
        address,
        message: challenge.message,
        signature,
      });
      if (
        accountRef.current?.toLowerCase() !== address.toLowerCase() ||
        !serviceRef.current
      )
        throw new Error(
          "The account or world connection changed. Please sign in again.",
        );
      connection.session = result;
      setSession(result);
      onSession(result);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.includes("rejected")
            ? "Signature declined. You can try again when ready."
            : e.message.split("\n")[0]
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setSigning(false);
    }
  }
  return (
    <>
      <button
        className="wallet-button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <Icon name="wallet" size={18} />
        <span>
          {isConnected && address
            ? shortAddress(getAddress(address))
            : "Connect"}
        </span>
      </button>
      {open && (
        <Modal
          title={isConnected ? "Visitor account" : "Connect a wallet"}
          onClose={() => setOpen(false)}
        >
          {isConnected && address ? (
            <>
              <p className="wallet-address">{getAddress(address)}</p>
              <p className="muted">
                {session
                  ? `Signed in as ${session.role}.`
                  : "Sign a message to let creatures remember this wallet. No transaction, fee, or private key."}
              </p>
              {!serviceConnected && (
                <p className="notice">
                  Connect to a world server in Settings to sign in. The private
                  demo does not use wallet identities.
                </p>
              )}
              {!session && (
                <button
                  className="primary full"
                  disabled={signing || !serviceConnected}
                  onClick={signIn}
                >
                  {signing ? "Waiting for signature…" : "Sign in to world"}
                  <Icon name="arrow" size={18} />
                </button>
              )}
              <button
                className="secondary full"
                onClick={() => {
                  disconnect();
                  connection.session = null;
                  setSession(null);
                  onSession(null);
                  setOpen(false);
                }}
              >
                Disconnect wallet
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                Explore without a wallet. Connect only to visit and be
                remembered.
              </p>
              <div className="wallet-list">
                {mobile &&
                  OPEN_IN.map((w) => (
                    <a
                      key={w.id}
                      href={w.href(location.href)}
                      className="wallet-row"
                    >
                      <img
                        width="28"
                        height="28"
                        src={`./wallets/${w.id}.svg`}
                        alt=""
                      />
                      <span>Open in {w.name}</span>
                      <Icon name="chevron" size={16} />
                    </a>
                  ))}
                {listed
                  .filter((c) => !mobile || c.type !== "injected")
                  .map((c) => {
                    const label =
                      c.id === "injected"
                        ? "Browser wallet"
                        : c.id === "coinbaseWalletSDK"
                          ? mobile
                            ? "Coinbase Smart Wallet"
                            : "Coinbase Wallet"
                          : c.name;
                    return (
                      <button
                        className="wallet-row"
                        key={c.uid}
                        disabled={isPending}
                        onClick={async () => {
                          setError("");
                          try {
                            await connectAsync({ connector: c });
                          } catch {
                            setError(
                              "Wallet connection declined or unavailable. Open your wallet and try again.",
                            );
                          }
                        }}
                      >
                        {c.icon ? (
                          <img width="28" height="28" src={c.icon} alt="" />
                        ) : c.id === "coinbaseWalletSDK" ? (
                          <img
                            width="28"
                            height="28"
                            src="./wallets/coinbase.svg"
                            alt=""
                          />
                        ) : (
                          <Icon name="wallet" size={28} />
                        )}
                        <span>
                          {label}
                          {isPending && variables?.connector === c
                            ? " · opening…"
                            : ""}
                        </span>
                        <Icon name="chevron" size={16} />
                      </button>
                    );
                  })}
              </div>
              <p className="fineprint">
                Wallets are accounts, not unique people. Smart wallets can
                connect; this prototype’s server accepts EIP-191 account
                signatures only.
              </p>
            </>
          )}
          <p className="error" role="alert">
            {error}
          </p>
        </Modal>
      )}
    </>
  );
}
