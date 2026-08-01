"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { cn } from "@/app/lib/utils";
import {
  describeQuote,
  formatQuotePct,
  formatQuotePrice,
  isLive,
  type MarketQuote,
} from "@/app/lib/market/quotes";

/** Une minute — le cache serveur a le même pas, inutile de demander plus vite. */
const REFRESH_MS = 60_000;

/**
 * Bandeau des marchés — la ligne la plus fine de l'interface.
 *
 * Il défile en continu, comme sur un terminal de salle des marchés. Ce choix a
 * un coût d'accessibilité que le composant paie explicitement : la piste
 * visuelle est dupliquée pour que la boucle soit sans couture, donc chaque
 * cotation existe deux fois dans le DOM. Les deux copies sont `aria-hidden`, et
 * un résumé textuel unique — lui, immobile — porte l'information pour les aides
 * techniques. Sans cela, un lecteur d'écran annoncerait tout deux fois.
 *
 * Le défilement s'arrête au survol et au focus clavier, et ne démarre pas du
 * tout si le système demande moins d'animations (`prefers-reduced-motion`).
 */
export function MarketTicker({ className }: { className?: string }) {
  const q = useQuery({
    queryKey: ["market-quotes"],
    queryFn: () =>
      fetchJson<{ quotes: MarketQuote[] }>("/api/market/quotes"),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });

  // Un instrument sans cours ne défile pas : une place fermée reste affichée
  // (« fermé » est une information), une cotation absente ne l'est pas.
  const quotes = (q.data?.quotes ?? []).filter((x) => x.last != null);
  const loading = q.isLoading && quotes.length === 0;

  return (
    <div
      className={cn("term-ticker", className)}
      data-testid="market-ticker"
      aria-label="Cotations de marché"
    >
      <p className="sr-only">
        {quotes.length === 0
          ? "Cotations de marché indisponibles."
          : quotes.map(describeQuote).join(". ")}
      </p>

      {loading || quotes.length === 0 ? (
        <div className="term-ticker-rail" aria-hidden>
          <span className="term-ticker-symbol">
            {loading ? "Chargement…" : "Cotations indisponibles"}
          </span>
        </div>
      ) : (
        <div className="term-ticker-marquee" aria-hidden>
          {/*
            Deux pistes identiques qui se suivent : quand la première a fini de
            sortir par la gauche, la seconde occupe exactement sa place, et
            l'animation peut repartir de zéro sans saut visible.
          */}
          {[0, 1].map((copy) => (
            <div className="term-ticker-track" key={copy}>
              {quotes.map((quote) => (
                <TickerItem
                  key={`${copy}-${quote.key}`}
                  quote={quote}
                  testId={copy === 0 ? `ticker-${quote.key}` : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TickerItem({
  quote,
  testId,
}: {
  quote: MarketQuote;
  /** Seule la première copie porte un identifiant : la seconde est un doublon. */
  testId?: string;
}) {
  const live = isLive(quote.state);
  const up = (quote.changePct ?? 0) >= 0;

  return (
    <span className="term-ticker-item" data-testid={testId}>
      <span className="term-ticker-symbol">{quote.label}</span>

      {live ? (
        <>
          <span className="term-ticker-price">
            {formatQuotePrice(quote.last!)}
          </span>
          {quote.changePct != null && (
            <span className={up ? "val-positive" : "val-negative"}>
              {formatQuotePct(quote.changePct)}
            </span>
          )}
        </>
      ) : (
        /*
          Place close : le dernier cours reste juste, mais l'afficher seul le
          ferait passer pour le cours du moment. On annonce donc l'état, et le
          cours de clôture le suit en retrait — l'information n'est pas perdue,
          elle est simplement datée.
        */
        <>
          <span className="term-ticker-closed">fermé</span>
          <span className="term-ticker-price term-ticker-price--stale">
            {formatQuotePrice(quote.last!)}
          </span>
        </>
      )}
    </span>
  );
}
