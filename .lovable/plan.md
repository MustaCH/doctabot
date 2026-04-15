

## Diagnóstico

Encontré dos problemas en la función SQL `search_properties_filtered`:

### Problema 1: La búsqueda por texto también busca en `office`
La función busca "Docta" en `p.office`, lo que devuelve **368 propiedades** de RE/MAX Docta que no tienen nada que ver con la zona Docta. Las propiedades que realmente mencionan "Docta" en título, zona o dirección son solo **105**. El usuario quiere buscar por ubicación/título, no por oficina.

### Problema 2: El filtro de tipo de propiedad no coincide con los valores de la DB
Los valores del selector son `"Departamento"`, `"Casa"`, `"Terreno"`, etc., pero en la base de datos los valores reales son slugs como `departamento_estandar`, `departamento_duplex`, `casa`, `terrenos_y_lotes`, `casa_duplex`, `ph`, etc. La comparación exacta (`p.property_type = type_filter`) nunca coincide para "Departamento" o "Terreno".

## Plan

### 1. Actualizar la función SQL `search_properties_filtered`
- **Quitar `office`** de los campos de búsqueda por texto — dejar solo `title`, `address`, `locality`, `zone`
- **Cambiar el filtro de tipo** de comparación exacta a `ILIKE` con prefijo, para que `"departamento"` coincida con `departamento_estandar`, `departamento_duplex`, `departamento_monoambiente`, etc. Y `"terreno"` coincida con `terrenos_y_lotes`

Lógica del type_filter:
```sql
AND (type_filter = '' OR 
     lower(p.property_type) ILIKE lower(type_filter) || '%'
     OR (lower(type_filter) = 'terreno' AND lower(p.property_type) LIKE 'terreno%'))
```

### 2. Actualizar las opciones del selector de tipo en `Properties.tsx`
Agregar los tipos que faltan y usar valores que matcheen como prefijo con la DB:
- `Casa` → matchea `casa`, `casa_duplex`, `casa_triplex`
- `Departamento` → matchea `departamento_estandar`, `departamento_duplex`, etc.
- `Terreno` → matchea `terrenos_y_lotes` (necesita lógica especial)
- Agregar `PH`, `Cochera`, `Campo`

### Archivos a tocar
- **Migración SQL**: recrear `search_properties_filtered` sin `office` en búsqueda y con filtro de tipo flexible
- **`src/pages/Properties.tsx`**: actualizar opciones del `<Select>` de tipo de propiedad

