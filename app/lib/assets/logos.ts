/**
 * Resolve logo URLs for portfolio assets via Logo.dev
 * @see https://www.logo.dev/docs/logo-images/introduction
 */

import { logoForAsset } from "../logos/logodev";

export function resolveAssetLogo(opts: {
  logoUrl?: string | null;
  ticker?: string | null;
  name?: string | null;
  assetClass?: string | null;
}): string | null {
  // Keep explicit logo.dev or custom uploaded URLs
  if (opts.logoUrl?.includes("logo.dev")) return opts.logoUrl;
  if (
    opts.logoUrl &&
    !opts.logoUrl.includes("clearbit.com") &&
    !opts.logoUrl.includes("simpleicons.org") &&
    !opts.logoUrl.includes("jsdelivr.net")
  ) {
    return opts.logoUrl;
  }

  return logoForAsset({
    ticker: opts.ticker,
    name: opts.name,
    assetClass: opts.assetClass,
    size: 128,
    theme: "auto",
  });
}
