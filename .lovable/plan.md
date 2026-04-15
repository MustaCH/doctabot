

## Diagnóstico: Morning Matches con zonas incorrectas

Analicé el caso de Aldana Ludueña. Sus datos:
- `preferred_zones`: NULL
- `property_type_interest`: NULL  
- Todo está en `notes`: "Duplex en Docta 2 dormitorios hasta 110K"

El algoritmo actual tiene **3 problemas graves**:

### Problema 1: `extractTypeFromTitle` contamina los tokens de tipo
La propiedad "VENTA **LOTE** VILLA CATALINA APTO **DUPLEX** 285 M2" tiene `property_type: terrenos_y_lotes` (es un lote), pero `extractTypeFromTitle` extrae "duplex" del título. Resultado: un lote matchea como duplex.

**Fix**: Solo usar `extractTypeFromTitle` como fallback cuando `property_type` es NULL.

### Problema 2: No se extraen las preferencias de zona del cliente desde notas
El matching actual extrae la zona de la **propiedad** y busca esas palabras en las notas del cliente. Pero nunca extrae las zonas que el **cliente** quiere desde sus notas para filtrar propiedades. El cliente dice "en Docta" pero las propiedades de Río Ceballos o Icho Cruz no son rechazadas.

**Fix**: Agregar función `extractClientZonesFromNotes` que parsee zonas del texto de notas. Si el cliente tiene zonas (ya sea en `preferred_zones` o extraídas de notas), la zona debe coincidir como requisito obligatorio — no como un criterio más entre 3.

### Problema 3: "Docta" no está en los patrones de zona
`extractZoneFromTitle` tiene "docta central" pero no "docta" solo. Las propiedades en Docta tienen `locality: "Docta - Urbanización Inteligente"` y `zone: NULL`.

**Fix**: Agregar `/\b(docta)\b/i` al listado de patrones de zona.

## Plan de cambios

### 1. Ambos archivos: `morning-matches/index.ts` y `use-property-matches.ts`

**a)** Agregar `docta` a los patrones de `extractZoneFromTitle`

**b)** No usar `extractTypeFromTitle` cuando `property_type` ya existe:
```typescript
// ANTES
const titleTypeTokens = property.title ? extractTypeFromTitle(property.title) : [];
const effectiveTypeTokens = [...new Set([...baseTypeTokens, ...titleTypeTokens])];

// DESPUÉS  
const titleTypeTokens = (!property.property_type && property.title) 
  ? extractTypeFromTitle(property.title) : [];
```

**c)** Agregar función para extraer zonas del cliente desde notas:
```typescript
function extractClientZonesFromNotes(notes: string): string[] {
  // Reutiliza los mismos patrones de zona que extractZoneFromTitle
  // Retorna todas las zonas encontradas en el texto
}
```

**d)** Hacer la zona **obligatoria** cuando el cliente tiene preferencia de zona:
```typescript
// Si el cliente tiene zonas preferidas (structured o desde notas),
// verificar que la propiedad coincida con alguna.
// Si no coincide en zona → no es match, sin importar budget/tipo.
const clientZones = [
  ...(client.preferred_zones?.split(",").map(z => z.trim()).filter(Boolean) || []),
  ...extractClientZonesFromNotes(client.notes || "")
];

if (clientZones.length > 0) {
  const zoneMatches = effectiveZone && clientZones.some(z => zonesMatch(effectiveZone, z));
  if (!zoneMatches) continue; // Skip — zona obligatoria no coincide
  reasons.push(`📍 Zona: ${effectiveZone}`);
}

// Luego evaluar budget y tipo normalmente
// Requerir al menos 1 criterio adicional (budget o tipo) además de zona
if (reasons.length < 2) continue;
```

### 2. Redeploy `morning-matches`

### Archivos a modificar
- `supabase/functions/morning-matches/index.ts` — matching del backend
- `src/hooks/use-property-matches.ts` — matching del frontend (misma lógica)

