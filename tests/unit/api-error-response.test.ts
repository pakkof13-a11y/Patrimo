import { describe, expect, it } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";
import { AccountingError } from "@/app/lib/accounting/types";
import {
  clientErrorMessage,
  clientErrorStatus,
  serverErrorDetail,
} from "@/app/lib/api/error-response";

describe("clientErrorMessage", () => {
  it("garde le message des erreurs métier (rédigées pour l'utilisateur)", () => {
    const e = new AccountingError(
      "INSUFFICIENT_QTY",
      "Quantité insuffisante : disponible 2, demandé 5"
    );
    expect(clientErrorMessage(e)).toContain("Quantité insuffisante");
    expect(clientErrorStatus(e)).toBe(400);
  });

  it("garde le message d'une Error volontaire de la couche service", () => {
    expect(clientErrorMessage(new Error("Plateforme source introuvable"))).toBe(
      "Plateforme source introuvable"
    );
  });

  it("masque les erreurs Prisma (fuite de schéma / contraintes)", () => {
    const e = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`userId`,`ticker`)",
      { code: "P2002", clientVersion: "7.9.0" }
    );
    expect(clientErrorMessage(e, "Erreur fiscale")).toBe("Erreur fiscale");
    expect(clientErrorMessage(e, "Erreur fiscale")).not.toContain("userId");
    expect(clientErrorStatus(e)).toBe(500);
  });

  it("masque une erreur d'initialisation Prisma (URL de connexion)", () => {
    const e = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at db.internal:5432",
      "7.9.0"
    );
    expect(clientErrorMessage(e)).toBe("Erreur");
    expect(clientErrorMessage(e)).not.toContain("db.internal");
  });

  it("retombe sur le libellé générique pour une valeur non-Error", () => {
    expect(clientErrorMessage("boom", "Erreur portfolio")).toBe(
      "Erreur portfolio"
    );
    expect(clientErrorMessage(null)).toBe("Erreur");
  });

  it("serverErrorDetail conserve le détail complet pour les logs", () => {
    const e = new Prisma.PrismaClientKnownRequestError("boom détaillé", {
      code: "P2002",
      clientVersion: "7.9.0",
    });
    expect(serverErrorDetail(e)).toContain("boom détaillé");
  });
});
