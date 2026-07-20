/**
 * Avatar utilisateur + initiales (localStorage, hors auth serveur).
 */

import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

const AVATAR_KEY = "userAvatarDataUrl";

export function loadUserAvatarDataUrl(): string | null {
  const v = loadUiPref<string | null>(AVATAR_KEY, null);
  if (typeof v === "string" && v.startsWith("data:image/")) return v;
  return null;
}

export function saveUserAvatarDataUrl(dataUrl: string | null): void {
  saveUiPref(AVATAR_KEY, dataUrl);
}

/** Deux premières lettres du username (affichage FAB). */
export function userInitials(username: string | null | undefined): string {
  const s = (username || "").trim();
  if (!s) return "?";
  // Prend alphanum, ignore underscores
  const cleaned = s.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüç]/gi, "");
  const base = cleaned || s;
  return base.slice(0, 2).toUpperCase();
}

/**
 * Lit un fichier image (jpg/png) → data URL, max ~400 ko après redimension.
 */
export function readImageFileAsDataUrl(
  file: File,
  maxEdge = 256
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      reject(new Error("Formats acceptés : JPG, PNG ou WebP"));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      reject(new Error("Image trop lourde (max 4 Mo)"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture fichier impossible"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(raw);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.88));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => reject(new Error("Image invalide"));
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}
