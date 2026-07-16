# Rapport d’audit — Import CSV (`import_csv`)

**Date :** 2026-07-16  
**Périmètre :** `app/lib/import/*`, `app/api/import/*`, `components/modals/import-csv-modal.tsx`

---

## 1. État initial (avant restructuration)

### Ce qui existait déjà

| Module | Rôle |
|--------|------|
| `csv-parse.ts` | Parseur léger `,` / `;` / tab, quotes, BOM |
| `normalize.ts` | Nombres FR/EN, dates ISO & DD/MM/YYYY |
| `presets.ts` | Formats Patrimo, generic, Binance, Boursorama, Revolut, Coinbase |
| `map-rows.ts` | Mapping → `ImportDraftRow` (validation + warnings) |
| `commit.ts` | Création assets + transactions en base |
| API `preview` / `commit` | Flux UI modal d’import |
| Tests unitaires | `tests/unit/import-csv.test.ts` |

### Anomalies / limites identifiées

1. **Pas de Strategy Pattern explicite** — formats = presets d’alias, logique métier dispersée dans `map-rows` (if formatId === revolut…).
2. **Encodage** — `file.text()` uniquement (UTF-8) ; exports Windows (ISO-8859-1) mal lus.
3. **Séparateur Excel** — ligne `sep=;` non gérée.
4. **Dates exotiques** — peu de formats (Excel serial, “15 Mar 2024”, ambiguïté US/FR partielle).
5. **Décimales** — OK pour FR/EN basiques ; espaces insécables / `−` unicode incomplets.
6. **CSV inconnu** — format `generic` limité ; pas de mapping manuel ni mémorisation.
7. **Nouvelles plateformes** (Fortuneo, TR, IBKR) — absentes.
8. **Contrat `TransactionImport`** — non formalisé (drafts Patrimo uniquement).

### Correctifs appliqués

- `decodeCsvBuffer` UTF-8 / UTF-16 / latin1  
- `parseNumber` / `parseDate` renforcés  
- `parseCsv` : skip `sep=`, commentaires `#`  
- Adaptateurs Strategy + registry  
- Auto-matching dynamique + UI mapping manuel  
- Persistance mapping (`localStorage`)  
- Presets Fortuneo, Trade Republic, Interactive Brokers  
- Point d’entrée `importCsv()`  

---

## 2. Architecture cible (Strategy Pattern)

```
CSV text / ArrayBuffer
        │
        ▼
   parseCsv()  ── delimiter, quotes, BOM
        │
        ▼
 detectBestAdapter(headers)  ── score 0–100
        │
        ├─► FortuneoAdapter | BinanceAdapter | … (alias presets)
        ├─► DynamicAdapter (auto-match keywords)
        │
        ▼
 adapter.parse({ headers, rows, columnMap? })
        │
        ├─► TransactionImport[]   (contrat standard BUY/SELL/DIVIDEND)
        └─► mapCsvToDrafts()      (compat commit existant)
```

### Interface commune

```ts
interface PlatformCsvAdapter {
  meta: { id, label, description };
  detect(headers: string[]): number;
  parse(input): AdapterParseResult; // TransactionImport[]
}
```

### Ajouter une plateforme

1. Ajouter un preset dans `presets.ts` (aliases + detectHints via registry), **ou**  
2. Créer un fichier `adapters/ma-plateforme.ts` et l’enregistrer dans `registry.ts`.

---

## 3. Parseur dynamique

1. **Auto-match** (`dynamic-mapper.ts`) : mots-clés Date/Price/Prix/Quantity… → rôles  
2. **Confiance** high / medium / low / none  
3. **UI** : panneau « Ajuster le mapping colonnes » si incomplet  
4. **Sauvegarde** : fingerprint des headers → `localStorage` (`mapping-store.ts`)  

---

## 4. Tests

Voir `tests/unit/import-csv.test.ts` (étendu) et `tests/unit/import-adapters.test.ts`.

Scénarios couverts : Patrimo, Binance, Coinbase, Revolut, nombres FR, dates, auto-match, `importCsv()` end-to-end.

---

## 5. Recommandations futures

- Persister les mappings en base (multi-device) plutôt que localStorage seul.  
- Extracteurs PDF (Trade Republic) hors CSV.  
- Différencier `description` et `name` plus finement pour Revolut.  
- Scoring de détection calibré sur corpus d’exports réels.  
