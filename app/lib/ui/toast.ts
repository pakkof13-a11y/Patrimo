/**
 * API toasts Patrimo — enveloppe fine autour de Sonner.
 * Durée 4 s, file gérée par Sonner, non bloquant pour la navigation.
 */
import { toast as sonnerToast } from "sonner";

export const TOAST_DURATION_MS = 4000;

type ToastOpts = {
  description?: string;
  duration?: number;
  id?: string | number;
};

export const appToast = {
  success(message: string, opts?: ToastOpts) {
    return sonnerToast.success(message, {
      duration: opts?.duration ?? TOAST_DURATION_MS,
      description: opts?.description,
      id: opts?.id,
    });
  },
  error(message: string, opts?: ToastOpts) {
    return sonnerToast.error(message, {
      duration: opts?.duration ?? TOAST_DURATION_MS,
      description: opts?.description,
      id: opts?.id,
    });
  },
  warning(message: string, opts?: ToastOpts) {
    return sonnerToast.warning(message, {
      duration: opts?.duration ?? TOAST_DURATION_MS,
      description: opts?.description,
      id: opts?.id,
    });
  },
  info(message: string, opts?: ToastOpts) {
    return sonnerToast.info(message, {
      duration: opts?.duration ?? TOAST_DURATION_MS,
      description: opts?.description,
      id: opts?.id,
    });
  },
  /** Neutre (mapping, info secondaire) */
  message(message: string, opts?: ToastOpts) {
    return sonnerToast.message(message, {
      duration: opts?.duration ?? TOAST_DURATION_MS,
      description: opts?.description,
      id: opts?.id,
    });
  },
  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },
};
