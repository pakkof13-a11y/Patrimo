"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

export function DisplayProvider({ children }: { children: React.ReactNode }) {
  // Toujours "fluid" au 1er rendu (SSR = client) — localStorage après mount
  const [layoutWidth, setLayoutWidthState] = useState<LayoutWidthMode>("fluid");

  useEffect(() => {
    setLayoutWidthState(loadLayoutWidth());
  }, []);

  const setLayoutWidth = useCallback((mode: LayoutWidthMode) => {
    setLayoutWidthState(mode);
    saveLayoutWidth(mode);
  }, []);

  const maxWidth = layoutMaxWidth(layoutWidth);

  const value = useMemo<DisplayContextValue>(() => {
    const kpiGridClass =
      "grid w-full min-w-0 gap-3 auto-rows-fr [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]";
    const dashboardGridClass =
      layoutWidth === "ultra" || layoutWidth === "fluid"
        ? "grid gap-4 lg:grid-cols-2 xl:grid-cols-3"
        : "grid gap-4 lg:grid-cols-2";

    return {
      layoutWidth,
      setLayoutWidth,
      maxWidth,
      shellClassName:
        "app-shell min-w-0 max-w-full space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 sm:py-6 lg:px-6",
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
        "app-shell min-w-0 max-w-full space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 sm:py-6",
      kpiGridClass:
        "grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]",
      dashboardGridClass: "grid gap-4 lg:grid-cols-2 xl:grid-cols-3",
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
