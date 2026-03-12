

# Fase 1: Ficha de Cliente Enriquecida + Tipo de Cliente

## Resumen

Expandir la tabla `clients` con campos estructurados para CRM inmobiliario, incluyendo un campo `client_type` que distingue entre clientes compradores/inquilinos y propietarios que quieren vender/alquilar. Rediseñar la UI de fichas de cliente para mostrar toda la información nueva.

## Cambios en Base de Datos

Migración SQL para agregar columnas a `clients`:

| Campo | Tipo | Propósito |
|---|---|---|
| `client_type` | text (default 'buyer') | Tipo: buyer, seller, both |
| `birthday` | date | Cumpleaños |
| `company` | text | Empresa / ocupación |
| `address` | text | Dirección actual del cliente |
| `preferred_zones` | text | Zonas de interés (compradores) |
| `budget_min` | numeric | Presupuesto mínimo |
| `budget_max` | numeric | Presupuesto máximo |
| `property_type_interest` | text | Tipo de propiedad buscada |
| `source` | text | Cómo llegó (referido, portal, etc.) |
| `last_contact_at` | timestamptz | Último contacto |

`client_type` valores:
- `buyer` — Busca comprar o alquilar
- `seller` — Quiere vender o poner en alquiler su propiedad
- `both` — Ambos (ej: vende una y compra otra)

## Cambios en UI (Clients.tsx)

1. **Tarjeta de cliente rediseñada**: Mostrar `client_type` con badge diferenciado (🔍 Comprador, 🏠 Vendedor, ↔️ Ambos), más los nuevos campos visibles (cumpleaños, empresa, presupuesto, zonas).

2. **Diálogos de crear/editar**: Agregar todos los campos nuevos organizados en secciones:
   - Datos personales: nombre, teléfono, email, cumpleaños, empresa, dirección
   - Tipo y estado: client_type, status, source
   - Preferencias (visible si buyer/both): zonas, presupuesto min/max, tipo propiedad
   - Notas

3. **Filtro por tipo de cliente**: Agregar tabs o filtro en el header para filtrar por tipo (Todos / Compradores / Vendedores).

## Archivos a Modificar

- **Nueva migración SQL**: ALTER TABLE clients ADD COLUMN para cada campo nuevo
- **src/pages/Clients.tsx**: Actualizar interface Client, formularios de crear/editar, tarjetas de visualización, agregar filtros
- **src/components/ImportClientsDialog.tsx**: Actualizar ParsedClient para incluir los nuevos campos si la IA los detecta en el Excel

