"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";
import { DisplayProvider } from "@/components/layout/display-provider";
import { NotificationsProvider } from "@/app/lib/notifications/context";
import { ErrorBoundary } from "@/components/layout/error-boundary";

/** Durée d’affichage des toasts Sonner (source unique). */
const TOAST_DURATION_MS = 4000;

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
              <Toaster
                position="top-right"
                closeButton
                theme="system"
                visibleToasts={5}
                gap={10}
                offset={16}
                toastOptions={{
                  // Source unique de la durée par défaut (évite double prop duration)
                  duration: TOAST_DURATION_MS,
                  closeButton: true,
                  classNames: {
                    toast: "patrimo-toast",
                    title: "text-[0.8125rem] font-medium",
                    description: "text-[0.75rem] opacity-80",
                    closeButton: "patrimo-toast-close",
                  },
                }}
              />
            </QueryClientProvider>
          </NotificationsProvider>
        </DisplayProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
