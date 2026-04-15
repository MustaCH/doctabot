

## Fix: Property type must be mandatory when client specifies it

### Problem
The matching algorithm requires zone match (mandatory) + at least 1 more criterion (budget or type). A client searching for "Duplex en Nueva Córdoba · Hasta USD 250.000" gets 235 results because every property in Nueva Córdoba under budget matches — CASAS, LOTES, DEPARTAMENTOS, everything. Type is never enforced.

### Root cause
In `findMatchReasons` (line 367-372), property type is treated as an optional bonus reason. The threshold of `reasons.length >= 2` is satisfied by zone + budget alone, so type is ignored even when the client explicitly specified it.

### Solution
Make property type **mandatory** when the client has `property_type_interest` set — same logic as zone. If the client specifies a type and the property doesn't match → skip entirely, no matter how many other criteria match.

### Changes in `supabase/functions/morning-matches/index.ts`

**1. `findMatchReasons`** — After the zone check (line 348), add a type gate:

```typescript
// Type — MANDATORY if client has type preference
if (client.property_type_interest) {
  const clientTokens = client.property_type_interest
    .split(",").map(t => t.trim()).filter(Boolean).flatMap(normalizePropertyType);
  
  // Also check title fallback for type
  const allTypeTokens = [...effectiveTypeTokens];
  if (allTypeTokens.length === 0 && property.title) {
    allTypeTokens.push(...extractTypeFromTitle(property.title));
  }
  
  if (allTypeTokens.length === 0 || !allTypeTokens.some(pt => clientTokens.includes(pt))) {
    return []; // No type match → skip entirely
  }
  reasons.push(`🏗️ Tipo: ${property.property_type || "desde título"}`);
}
```

Remove the old optional type block (lines 367-372) since it's now handled above.

**2. Same fix in `src/hooks/use-property-matches.ts`** — Apply identical mandatory type logic in the frontend matching hook to keep both in sync.

### What this achieves
- Client with `property_type_interest: "Duplex"` will ONLY match properties that are duplex/PH
- Client without `property_type_interest` keeps current behavior (any type)
- Dramatically reduces false positives (235 → likely ~10-20 real matches)

### Files to modify
- `supabase/functions/morning-matches/index.ts` — mandatory type in `findMatchReasons`
- `src/hooks/use-property-matches.ts` — same fix for frontend consistency
- Deploy edge function

