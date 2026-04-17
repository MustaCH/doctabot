

## Reporte General del Proyecto Alan/DoctaBot

### Estado actual (resumen ejecutivo)
El proyecto es funcional y bien diseñado, pero acumuló deuda técnica esperable de un MVP en crecimiento. Los problemas más urgentes son **3 de seguridad**, **3 bugs visibles en consola**, y varios cuellos de botella de **performance/mantenibilidad** que hoy no rompen nada pero lo harán cuando crezca de 31 a 100+ agentes.

---

### Hallazgos por categoría

#### Seguridad (alta prioridad)
1. **`/superadminpanel` con PIN hardcodeado en el frontend**: `ADMIN_PIN = "7742"` está en `SuperAdmin.tsx` y en `admin-stats/index.ts`. Cualquiera que abra DevTools lo lee. La ruta tampoco está protegida por `ProtectedRoute`. El PIN debe migrarse a un secret de servidor + verificación contra rol `super_admin` real.
2. **Tabla `scraping_logs` tiene RLS habilitado pero 0 policies**: silenciosamente bloquea cualquier acceso desde el cliente. Si algún día se intenta leer desde frontend, falla sin error claro. Falta una policy explícita (super_admin only).
3. **Tabla `properties` con policy `USING true`**: cualquier usuario autenticado lee todas las propiedades. Está OK funcionalmente, pero conviene documentarlo y restringir columnas sensibles si surgen.
4. **Auth de Supabase**: linter reporta "Leaked Password Protection" deshabilitado. Activarlo en el panel de Auth.

#### Bugs activos (visibles en consola hoy mismo)
5. **3 warnings de React** por `memo()` recibiendo refs sin `forwardRef`: en `AssistantContent`, `CopyButton` y `SwipeableConversationItem`. No rompe pero spammea la consola y bloquea integraciones futuras (animaciones, virtualización).
6. **Push notifications con muy baja adopción** (6 subs / 31 usuarios = 19%). Probablemente UX poco visible o falla silenciosa en iOS/Safari.

#### Performance y escalabilidad
7. **`messages` sin índice compuesto `(conversation_id, created_at)`**: con 3261 filas todavía rinde, pero `ORDER BY created_at` dentro de una conversación va a degradarse.
8. **`supervisor_logs` (1506 filas) y `scraping_logs` (926 filas) sin índice por `created_at`**: el dashboard de SuperAdmin que ordena por fecha hace full scan.
9. **No hay limpieza/retención** para `supervisor_logs`, `client_activity_log`, `scraping_logs` — crecen sin límite.

#### Mantenibilidad
10. **`supabase/functions/chat/index.ts` tiene 2546 líneas** en un solo archivo: system prompt, 30 tools, supervisor, fallback, push, n8n. Imposible de revisar sin riesgo. Hay que partir en módulos (`tools/`, `supervisor.ts`, `prompt.ts`, `notifications.ts`).
11. **`SuperAdmin.tsx` (1425 líneas)** mezcla 8 pestañas + lógica de fetch + CSV/PDF export. Partir por pestaña.
12. **13 usos de `any`** en código cliente, abundantes `as any` en `admin-stats` — perdemos la red de tipos de Supabase.
13. **Sin tests reales**: solo `example.test.ts` placeholder. Vitest está configurado pero no se aprovecha.

#### Inconsistencias menores
14. **Onboarding usa `localStorage` (`alan_onboarding_done`, `alan_tutorial_done`)** en vez de columnas en `profiles`: si el agente cambia de dispositivo, repite tutorial.
15. **`config.toml`** lista solo 6 funciones; `transcribe`, `morning-matches`, `parse-client-import`, `send-push-notification` quedan con verify_jwt default — confirmar que lo correcto es así para cada una.
16. **CORS abierto a `*`** en todas las edge functions — aceptable pero conviene restringir a `chat.doctabot.online` y previews de Lovable.

---

### Plan de mejoras por fases

#### Fase 1 — Seguridad y bugs visibles (sesión corta, alto impacto)
- Mover `ADMIN_PIN` a un secret (`SUPER_ADMIN_PIN`) y validar también que el caller tenga rol `super_admin` en `user_roles` (doble factor: PIN + rol).
- Proteger `/superadminpanel` con `ProtectedRoute` + verificación de rol.
- Crear policy explícita en `scraping_logs` ("solo super_admin lee/escribe vía service role").
- Activar Leaked Password Protection en Auth.
- Convertir `ChatMessage`, `AssistantContent`, `CopyButton`, `SwipeableConversationItem` a `forwardRef` + `memo` correctamente — elimina warnings.

#### Fase 2 — Performance de DB
- Agregar índices: `messages(conversation_id, created_at DESC)`, `supervisor_logs(created_at DESC)`, `supervisor_logs(user_id, created_at DESC)`, `scraping_logs(created_at DESC)`, `client_activity_log(client_id, created_at DESC)`.
- Job de retención (pg_cron): borrar `supervisor_logs` > 90 días, `scraping_logs` > 30 días, `client_activity_log` > 180 días.

#### Fase 3 — Refactor del edge function `chat`
- Partir en: `prompt.ts` (system prompt), `tools/index.ts` (registro de 30 tools), `tools/properties.ts`, `tools/clients.ts`, `tools/calendar.ts`, `tools/email.ts`, `supervisor.ts`, `notifications.ts` (push + n8n).
- Mantener el `index.ts` como orquestador < 300 líneas.
- Sin cambios funcionales — solo organización.

#### Fase 4 — Refactor SuperAdmin + tipos
- Partir `SuperAdmin.tsx` en `pages/SuperAdmin/` con un archivo por pestaña (`UsersTab.tsx`, `PropertiesTab.tsx`, `SupervisorTab.tsx`, etc.).
- Reemplazar `any` por tipos generados de Supabase en `admin-stats` y componentes.

#### Fase 5 — Push, onboarding y polish
- Mover `alan_onboarding_done` y `alan_tutorial_done` a columnas booleanas en `profiles` (sin perder retrocompatibilidad).
- Mejorar UX de activación de push: banner persistente en Profile + tracking de motivo de fallo (Safari iOS, permiso denegado, etc.).
- Restringir CORS de edge functions a dominios conocidos.

#### Fase 6 — Tests críticos
- Tests Deno para `chat/tools/*` (mocks de Supabase): validar que `search_properties`, `create_client`, `link_conversation` funcionan.
- Tests Vitest de `use-chat-messages` (lógica de `MSG_BREAK`, citas, audio).
- Tests RLS: scripts SQL que verifican que un usuario A no puede leer datos de B.

### Cómo proceder
Sugiero empezar por **Fase 1** (1 sesión, alto impacto, bajo riesgo) y luego decidir según prioridad de negocio. Cada fase es independiente y entregable por separado.

