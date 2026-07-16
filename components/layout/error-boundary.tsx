"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toErrorMessage } from "@/app/lib/api-client";

type Props = {
  children: ReactNode;
  /** Zone label for logs */
  label?: string;
};

type State = {
  error: unknown;
};

/**
 * Catch React render errors — évite l'écran blanc total.
 * Accepte Error ou objet jeté (évite l'affichage "[object Object]").
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.error != null) {
      const message = toErrorMessage(
        this.state.error,
        "Erreur d'affichage inconnue"
      );
      return (
        <div
          className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-950/40"
          data-testid="error-boundary"
          role="alert"
        >
          <h2 className="text-base font-semibold text-rose-900 dark:text-rose-100">
            Une erreur d&apos;affichage est survenue
          </h2>
          <p className="mt-2 text-sm text-rose-800/80 dark:text-rose-200/80">
            {message}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => this.setState({ error: null })}
            >
              Réessayer
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
            >
              Recharger la page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
