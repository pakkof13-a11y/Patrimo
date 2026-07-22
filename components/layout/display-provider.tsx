"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  LAYOUT_WIDTH_OPTIONS,
  layoutMaxWidth,
  loadLayoutWidth,
  saveLayoutWidth,
  type LayoutWidthMode,
} from "@/app/lib/display-preferences";

type DisplayContextValue = {
  layoutWidth: LayoutWidthMode;
  setLayoutWidth: (mode: LayoutWidthMode) => void;
  maxWidth: string;
  shellClassName: string;
  kpiGridClass: string;
  dashboardGridClass: string;
};

const DisplayContext = createContext<DisplayContextValue | null>(null);

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function DisplayProvider({ children }: { children: React.ReactNode }) {
  // Toujours "fluid" au 1er rendu (SSR = client) — localStorage après mount
  const isClient = useIsClient();
  const [layoutWidth, setLayoutWidthState] = useState<LayoutWidthMode>("fluid");
  const [seeded, setSeeded] = useState(false);

  // Seed depuis localStorage au passage client (adjust state while rendering)
  if (isClient && !seeded) {
    setSeeded(true);
    setLayoutWidthState(loadLayoutWidth());
  }

  const setLayoutWidth = useCallback((_mode: LayoutWidthMode) => {
    // Layout modes retirés de l’UI — toujours fluide
    setLayoutWidthState("fluid");
    saveLayoutWidth("fluid");
  }, []);

  const maxWidth = layoutMaxWidth(layoutWidth);

  const value = useMemo<DisplayContextValue>(() => {
    const kpiGridClass =
      "grid w-full min-w-0 gap-2.5 auto-rows-fr sm:gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.25rem),1fr))]";
    const dashboardGridClass =
      layoutWidth === "ultra" || layoutWidth === "fluid"
        ? "grid gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3"
        : "grid gap-3 sm:gap-4 lg:grid-cols-2";

    return {
      layoutWidth,
      setLayoutWidth,
      maxWidth,
      /* section-stack : gap design system entre header zones */
      shellClassName:
        "app-shell section-stack min-w-0 max-w-full px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6",
      kpiGridClass,
      dashboardGridClass,
    };
  }, [layoutWidth, maxWidth, setLayoutWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty("--app-max-width", maxWidth);
    document.documentElement.dataset.layout = layoutWidth;
  }, [maxWidth, layoutWidth]);

  return (
    <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
  );
}

export function useDisplay() {
  const ctx = useContext(DisplayContext);
  if (!ctx) {
    return {
      layoutWidth: "fluid" as LayoutWidthMode,
      setLayoutWidth: () => undefined,
      maxWidth: "2560px",
      shellClassName:
        "app-shell section-stack min-w-0 max-w-full px-3 py-4 sm:px-5 sm:py-5",
      kpiGridClass:
        "grid w-full min-w-0 gap-2.5 sm:gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.25rem),1fr))]",
      dashboardGridClass: "grid gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3",
    };
  }
  return ctx;
}

export function Shell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { shellClassName } = useDisplay();
  return <div className={className || shellClassName}>{children}</div>;
}

export { LAYOUT_WIDTH_OPTIONS };
