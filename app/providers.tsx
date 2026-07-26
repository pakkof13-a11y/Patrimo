"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";
import { DisplayProvider } from "@/components/layout/display-provider";
import { NotificationsProvider } from "@/app/lib/notifications/context";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { BrandPageBackground } from "@/components/branding/brand-page-background";

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
      {/*
        disableTransitionOnChange retiré : permet une transition douce (CSS)
        sur logos / fonds marque. Anti-flash initial : suppressHydrationWarning
        sur <html>/<body> + logos en fallback light tant que le thème n’est pas monté.
      */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <BrandPageBackground />
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
                    toast: "aurea-toast",
                    title: "text-[0.8125rem] font-medium",
                    description: "text-[0.75rem] opacity-80",
                    closeButton: "aurea-toast-close",
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
