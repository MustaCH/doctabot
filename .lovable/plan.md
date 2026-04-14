

## Plan: Ampliar zonas de Córdoba en el extractor de títulos

### Cambio único

**Archivo:** `src/hooks/use-property-matches.ts` — función `extractZoneFromTitle` (líneas 55-83)

Agregar las siguientes zonas/barrios faltantes de Córdoba Capital y alrededores:

**Barrios tradicionales:** Alberdi, Alta Córdoba, Güemes, Cofico, Juniors, San Vicente, Observatorio, Jardín, San Martín, Rogelio Martínez, Residencial América, Villa Cabrera, Cerro Norte, Urca, Quebrada de las Rosas, Villa Belgrano, Jardín Espinosa, Parque Vélez Sársfield

**Zona Norte/Sierras Chicas:** Saldán, Río Ceballos, La Calera, Salsipuedes, Villa Carlos Paz, Cosquín, La Granja, Agua de Oro

**Countries/Barrios cerrados:** Las Delicias, Jardín Claret, El Bosque, Valle del Golf, Lomas de la Carolina, La Rufina, Cinco Lomas, Causana, Terrazas de O'Higgins, El Prado, Altos del Chateau, Palmas del Claret, Solares de Santa María, Las Cañitas, Chacras del Norte, Don Miguel, Jardines del Olmo

**Zona Sur:** Barrio Jardín, Villa Carlos Paz, Barrio Los Platanos, Los Boulevares, Inaudi, Tablada Park

**Otros desarrollos:** Cuesta Colorada, El Remanso, Las Piedras, Tierra Alta, Pueyrredón, B° SEP, Altos de Villasol

Se mantiene la misma estructura de regex con `\b(nombre)\b/i`. Total estimado: ~50+ zonas nuevas.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/hooks/use-property-matches.ts` | Ampliar array `zonePatterns` con ~50 zonas adicionales |

