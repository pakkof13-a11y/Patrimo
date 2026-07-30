import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/**
 * IBM Plex — la famille du terminal patrimonial.
 *
 * Plex Sans porte les libellés, Plex Mono TOUS les nombres : c'est
 * l'alignement vertical des chiffres d'une colonne à l'autre qui fait lire
 * « instrument financier » plutôt que « site web ». Les graisses sont
 * limitées à 400/500/600 — au-delà, la densité tourne au bruit.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aurea — Suivi de patrimoine",
  description:
    "Tableau de bord d'investissement : transactions, CUMP, multi-devises, plateformes.",
  // Favicon / apple-icon : convention fichiers app/icon.png + app/apple-icon.png
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      {/* suppressHydrationWarning : next-themes / extensions navigateur touchent le DOM */}
      <body
        className={`${plexSans.variable} ${plexMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
