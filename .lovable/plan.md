## Problema

La funcion `zonesMatch` tiene un check de palabras parciales demasiado agresivo. La linea:

```js
pzWords.some((w) => w.length > 3 && czWords.some((cw) => cw.includes(w) || w.includes(cw)))
```

Hace que "santa" (de "Santa Maria") matchee con "san" (de "San Salvador") porque `"santa".includes("san")` es `true`. Esto genera falsos positivos como Falda del Carmen matcheando con Barrio San Salvador.

## Solucion

Endurecer la funcion `zonesMatch` en ambos archivos (frontend y backend):

1. **Subir el minimo de longitud de palabra** de 3 a 4 caracteres para evitar que "san" sea candidato
2. **Requerir que ambas palabras tengan al menos 4 caracteres** antes de comparar substrings
3. **Exigir un ratio minimo de similitud** — solo matchear si la palabra mas corta tiene al menos 80% de la longitud de la mas larga (evita que "santa" matchee "san" pero permite que "cordoba" matchee "córdoba")

Concretamente, reemplazar la logica de palabras parciales por:

```js
// Only match words where both are 4+ chars and one is nearly a full substring of the other
return pzWords.some((w) => w.length >= 4 && czWords.some((cw) => {
  if (cw.length < 4) return false;
  const shorter = w.length <= cw.length ? w : cw;
  const longer = w.length > cw.length ? w : cw;
  return longer.includes(shorter) && shorter.length / longer.length >= 0.75;
}));
```

Esto:
- "santa" vs "san": `"san".length < 4` → false (no matchea)
- "cordoba" vs "córdoba": No van a matchear por acento, pero ya se cubren con `pz.includes(cz)` si la zona es exacta
- "villa" vs "villa": 5/5 = 1.0 >= 0.75 → true (matchea correctamente)
- "allende" vs "allen": 5/7 = 0.71 → false (no matchea, correcto)

## Archivos a modificar

1. `src/hooks/use-property-matches.ts` — funcion `zonesMatch` (linea 218-226)
2. `supabase/functions/morning-matches/index.ts` — funcion `zonesMatch` (linea 108-115)
3. Redeploy de `morning-matches`
