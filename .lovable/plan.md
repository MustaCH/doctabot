

## Corrección: `?associate=` solo en URLs de RE/MAX

### Problema
La función `injectAssociate` en `ChatMessage.tsx` inyecta el parámetro `?associate=agentCode` en URLs de **4 portales**: remax, zonaprop, argenprop y mercadolibre. Solo debería hacerlo en URLs de RE/MAX.

### Cambio
En `src/components/ChatMessage.tsx`, línea 18, cambiar el regex de dominios:

```typescript
// ANTES
if (!/remax\.com\.ar|zonaprop\.com|argenprop\.com|inmuebles\.mercadolibre/i.test(url)) return url;

// DESPUÉS
if (!/remax\.com\.ar/i.test(url)) return url;
```

Un solo archivo, una sola línea.

