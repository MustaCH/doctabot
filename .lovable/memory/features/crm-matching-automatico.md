---
name: Auto Property Matching
description: Exact zone (mandatory if client has preferences), normalized type, budget regex, 15% tolerance. Zone extracted from notes too.
type: feature
---
Motor de matching automático (use-property-matches.ts + morning-matches edge function) que cruza propiedades con clientes:

- **Zona obligatoria**: Si el cliente tiene zonas preferidas (en `preferred_zones` o extraídas de `notes` con `extractClientZonesFromNotes`), la propiedad DEBE coincidir en zona. Si no coincide → no es match sin importar budget/tipo.
- **Tipo de propiedad**: `normalizePropertyType` mapea slugs de DB a tokens comparables. `extractTypeFromTitle` solo se usa como fallback cuando `property_type` es NULL (evita contaminación de tokens, ej: lote con "apto duplex" en título).
- **Presupuesto**: Tolerancia del 15% sobre budget_max. También se parsean presupuestos de notas con regex (K/M suffixes).
- **Notas**: `extractClientZonesFromNotes` y `extractFromNotes` complementan datos estructurados faltantes.
- **Umbral**: Mínimo 2 criterios coincidentes para considerar un match.
- **"Docta"**: Agregado como patrón de zona independiente (`/\b(docta)\b/i`).
