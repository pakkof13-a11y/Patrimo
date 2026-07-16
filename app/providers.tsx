"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";
import { DisplayProvider } from "@/components/layout/display-provider";
import { NotificationsProvider } from "@/app/lib/notifications/context";
import { ErrorBoundary } from "@/components/layout/error-boundary";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Les erreurs restent dans React Query (toast / UI) — pas d'overlay
            // Next avec un objet non-Error en throwOnError.
            throwOnError: false,
            retry: 1,
          },
          mutations: {
            throwOnError: false,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <DisplayProvider>
          <NotificationsProvider>
            <QueryClientProvider client={client}>
              <ErrorBoundary label="app">{children}</ErrorBoundary>
              <Toaster richColors position="top-right" closeButton theme="system" />
            </QueryClientProvider>
          </NotificationsProvider>
        </DisplayProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
