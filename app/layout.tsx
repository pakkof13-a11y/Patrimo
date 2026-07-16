import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Patrimo — Suivi de patrimoine",
  description:
    "Tableau de bord d'investissement : transactions, CUMP, multi-devises, plateformes.",
  icons: {
    icon: [{ url: "/patrimo.jpg", type: "image/jpeg" }],
    apple: [{ url: "/patrimo.jpg", type: "image/jpeg" }],
    shortcut: "/patrimo.jpg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      {/* suppressHydrationWarning : next-themes / extensions navigateur touchent le DOM */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
