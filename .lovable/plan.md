

## Plan: Fix del matching de propiedades — Extraer datos del título y notas de forma más inteligente

### Problema raíz

Hay **3 problemas** que impiden que clientes como Ana Yamila Zuban, Belen Maiz o Eliana Ibarra aparezcan como compatibles:

1. **`zone` es NULL** en la mayoría de propiedades — la zona solo aparece en el título (ej. "Duplex en venta Docta Central 2 Dorm"). Como el matching depende de `property.zone`, nunca encuentra coincidencia de zona.

2. **`property_type` es "ph"** para dúplex — pero las notas de los clientes dicen "Duplex", no "ph". El tipo `ph` no genera token "duplex" en la normalización.

3. **Las notas solo se usan como fallback** — si un cliente tiene algún campo estructurado (aunque sea irrelevante), las notas se ignoran. Y la mayoría de clientes importados tienen toda la info en notas ("Que quiere: Duplex en Docta 2 dormitorios hasta 110000") con campos estructurados vacíos.

4. **Formato "110K"** en notas no se parsea como 110000.

### Cambios en `src/hooks/use-property-matches.ts`

#### A. Extraer zona y tipo del título de la propiedad
Agregar `title` al `PropertyForMatch` interface y pasarlo desde `Properties.tsx`. Cuando `zone` es null, buscar keywords de zona conocidos en el título. Cuando `property_type` es ambiguo, también buscar tokens de tipo en el título.

#### B. Mapear "ph" → incluir "duplex" como token
En `normalizePropertyType`, agregar que `ph` también genere token "duplex" (ya que en Argentina los dúplex se clasifican frecuentemente como PH).

#### C. Siempre ejecutar extracción de notas
Cambiar la lógica de `else if (c.notes)` a ejecutar **siempre** la extracción de notas como complemento (no como fallback), sumando razones que no se hayan encontrado ya por campos estructurados.

#### D. Parsear sufijos K/M en presupuestos de notas
Actualizar el regex de `extractFromNotes` para detectar formatos como "110K", "110k", "45K" y convertirlos correctamente.

#### E. Zona parcial en notas
Cuando se busca zona en notas, dividir la zona en palabras y matchear si al menos la palabra principal aparece (ej. "Docta" matchea "Docta Central").

### Cambio en `src/pages/Properties.tsx`

Pasar `title` en el objeto que se envía a `findMatches`:
```
findMatches({ zone: p.zone, price: p.price, currency: p.currency, property_type: p.property_type, title: p.title });
```

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/hooks/use-property-matches.ts` | Agregar `title` al interface, fix tokens ph→duplex, notas siempre, parseo K/M, zona desde título |
| `src/pages/Properties.tsx` | Pasar `title` a `findMatches` |

