---
name: Auto Property Matching
description: Exact zone, normalized type, budget as max with 30% tolerance
type: feature
---

## Matching Rules
- Zone: MANDATORY if client has zone prefs. Matches structured + notes zones.
- Type: MANDATORY if client has type pref. Normalized tokens (duplex↔ph, lote↔terreno).
- Budget: Single value = budget_max (client's ceiling). AI must store single numbers in `budget_max`.
  - Tolerance: properties up to **30% above** budget_max are included (negotiation margin).
  - If both min and max: `price >= min * 0.85 AND price <= max * 1.30`.
- Notes: Supplementary matching for zone, type, and budget from free text.
- Minimum 2 criteria required to avoid false positives.

## Budget Display
- Single value → "Hasta USD X" (never "Desde")
- Two values → "USD min – max"

## AI Tool Descriptions
- `budget_max`: "Si el cliente menciona un solo número, usarlo aquí"
- `budget_min`: "Solo si el cliente da un rango explícito con dos valores"
