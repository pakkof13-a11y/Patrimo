import base from "./playwright.config";
import type { PlaywrightTestConfig } from "@playwright/test";

/** Config jetable : Chromium du conteneur (le pin du projet n'est pas installé). */
const config: PlaywrightTestConfig = {
  ...base,
  use: {
    ...base.use,
    launchOptions: {
      executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
};

export default config;
