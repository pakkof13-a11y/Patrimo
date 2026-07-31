import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/**
 * IBM Plex — la famille du terminal patrimonial.
 *
 * Plex Sans porte les libellés, Plex Mono TOUS les nombres : c'est
 * l'alignement vertical des chiffres d'une colonne à l'autre qui fait lire
 * « instrument financier » plutôt que « site web ». Les graisses de travail
 * s'arrêtent à 600 — au-delà, la densité tourne au bruit ; 300 n'existe que
 * pour le titre de l'écran de connexion.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  // 300 inclus pour le titre de l'écran de connexion : sans lui, `font-weight:
  // 300` retombe silencieusement sur 400 et le titre perd sa légèreté.
  weight: ["300", "400", "500", "600"],
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
    /*
      Les variables de police sont posées sur <html>, pas sur <body>.

      `--font-sans` est déclarée dans `:root` (donc sur <html>) et vaut
      `var(--font-plex-sans), …`. Une propriété personnalisée se substitue au
      moment du calcul, sur l'élément qui la déclare : tant que
      `--font-plex-sans` vivait sur <body>, elle était invisible depuis
      <html>, `--font-sans` devenait invalide et toute l'application retombait
      silencieusement sur la police système.
    */
    <html
      lang="fr"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning : next-themes / extensions navigateur touchent le DOM */}
      <body className="antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
