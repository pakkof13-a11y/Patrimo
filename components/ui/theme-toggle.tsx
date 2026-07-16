"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "./button";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useIsClient();

  if (!mounted) {
    return (
      <Button variant="ghost" size="sm" aria-label="Thème">
        <Sun className="h-3.5 w-3.5" />
      </Button>
    );
  }

  const dark = (resolvedTheme || theme) === "dark";

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={dark ? "Mode clair" : "Mode sombre"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Mode clair" : "Mode sombre"}
    >
      {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </Button>
  );
}
