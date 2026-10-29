// Loaded only when the owner explicitly enables the archived settlement client.
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walletConfig } from "./wallet";
import Settlement from "./App";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
export default function Legacy() {
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <Settlement />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
