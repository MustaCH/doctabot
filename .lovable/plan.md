
## Plan: diagnosticar y corregir por qué iOS marca push como “exitosa” pero nunca la muestra

### Lo más probable
No parece ser un problema del iPhone 8 Plus en sí. El factor relevante es la versión y el modo de uso:

- En iPhone, las push web funcionan recién desde **iOS 16.4+**
- Además, en iOS **solo funcionan si Alan está instalado en la pantalla de inicio** y se abre como app instalada, no como pestaña normal de Safari
- Hoy el sistema puede marcar un envío como “exitoso” porque Apple responde `201`, pero eso solo confirma que **aceptó el request**, no que la notificación se haya mostrado

También encontré una causa técnica muy fuerte en el código actual: hay **dos service workers distintos en el mismo proyecto**:
- uno generado por `vite-plugin-pwa`
- otro manual: `/sw-push.js`

Eso puede dejar el flujo en un estado inconsistente: la suscripción se crea con uno, pero el worker que queda activo no es el que escucha el evento `push`. En ese escenario Apple acepta el envío, el panel lo cuenta como éxito, pero la notificación nunca aparece.

### Qué se va a implementar

#### 1. Unificar el manejo de push en un solo service worker
Eliminar la arquitectura de “dos workers en paralelo” y dejar **un único service worker** responsable de:
- recibir el evento `push`
- mostrar la notificación con `showNotification`
- manejar `notificationclick`
- convivir con la configuración PWA existente sin competir por el mismo scope `/`

La opción más segura es mover la lógica de `public/sw-push.js` al worker principal de la PWA y dejar una sola fuente de verdad.

#### 2. Detectar correctamente si iPhone realmente puede recibir push
Actualizar el hook de notificaciones para no asumir soporte solo por `serviceWorker` + `PushManager`.

Se agregará validación de:
- iOS versión `16.4+`
- app abierta en modo instalado/home screen (`display-mode: standalone` o equivalente en iOS)
- contexto correcto antes de permitir activar push

Así evitamos falsos estados como:
- “notificaciones activadas” en una pestaña Safari donde en realidad nunca van a llegar
- usuarios creyendo que el problema es del servidor cuando en realidad falta instalar la app

#### 3. Mejorar el estado visible en Perfil
El bloque de notificaciones va a diferenciar claramente estos casos:
- **Instalada y soportada** → puede suscribirse
- **Safari tab normal** → mostrar mensaje tipo “Para recibir notificaciones en iPhone, abrí Alan desde la pantalla de inicio”
- **iOS menor a 16.4** → mostrar que el dispositivo no soporta web push
- **Permiso concedido pero suscripción inválida** → re-suscribir automáticamente

#### 4. Hacer más honesto el panel de Super Admin
El panel hoy muestra “exitosa” cuando el servidor recibió `201`. Eso es útil, pero no significa entrega visible.

Se va a cambiar la lectura del panel para separar:
- **Aceptada por push provider** (`accepted`)
- **Fallida**
- **Suscripción limpiada**
- opcionalmente una nota aclarando que “accepted” no garantiza display en iOS

Además conviene guardar más contexto por intento:
- endpoint preview
- plataforma detectada si está disponible
- fuente del envío (`chat`, `admin_test`, etc.)

#### 5. Registrar metadatos del dispositivo/suscripción
Para poder auditar mejor por qué aparecen “2 dispositivos”, cada suscripción nueva debería guardar también:
- `user_agent`
- `platform`
- `is_standalone`
- `device_label` derivado si es posible

Así el panel podrá mostrar:
- 2 suscripciones del mismo iPhone
- una suscripción desde Safari y otra desde la app instalada
- o suscripciones viejas que conviene podar

#### 6. Limpiar y re-registrar suscripciones tras unificar el worker
Después de consolidar el service worker, conviene forzar una limpieza controlada de suscripciones antiguas para evitar que queden endpoints asociados al flujo viejo.

La idea:
- borrar suscripciones obsoletas del usuario de prueba
- volver a suscribir desde la app instalada
- probar de nuevo desde Super Admin y desde una conversación real con Alan

### Qué esperamos validar después
Con estos cambios, deberían darse dos resultados claros:

1. Si tu iPhone 8 Plus está en **iOS 16.4 o superior** y Alan está instalado en la pantalla de inicio:
- la notificación de prueba debería llegar
- la respuesta en segundo plano de Alan también debería llegar

2. Si estás en:
- iOS menor a 16.4, o
- abriendo Alan como pestaña Safari en lugar de app instalada

entonces la UI debería decirlo explícitamente, en vez de mostrar un estado engañoso de “activadas”.

### Respuesta corta a tu duda sobre el iPhone 8 Plus
Sí, **la versión de iOS influye**, pero no el modelo por sí mismo.

- **iPhone 8 Plus + iOS 16.4 o superior**: debería poder recibir push web
- **iPhone 8 Plus con iOS 16.0 / 16.1 / 16.2 / 16.3**: no
- **aunque tengas 16.4+**, si Alan no está abierto como app instalada desde la pantalla de inicio, en iPhone tampoco va a funcionar correctamente

Así que probar en un dispositivo más nuevo puede ayudar, pero antes conviene corregir el conflicto de service worker, porque ese hoy es el candidato más fuerte a la causa raíz.

### Archivos a tocar
- `vite.config.ts` — consolidar la estrategia PWA/service worker
- `src/main.tsx` — registro/control del worker en contextos válidos
- `src/hooks/use-push-notifications.ts` — detección real de soporte iOS + estado instalado
- `public/sw-push.js` o reemplazo por worker unificado — mover handlers `push` y `notificationclick`
- `src/pages/Profile.tsx` — mensajes de estado más precisos
- `supabase/functions/send-push-notification/index.ts` — refinar semántica de delivery logs
- `supabase/functions/admin-stats/index.ts` — ajustar métricas y detalle de suscripciones
- migración nueva para ampliar metadata de `push_subscriptions` si se registra contexto de dispositivo

### Verificación final
Se validará este flujo exacto:
1. Instalar Alan en la pantalla de inicio del iPhone
2. Abrir Alan desde el ícono instalado
3. Activar notificaciones desde Perfil
4. Confirmar que exista una sola suscripción vigente y bien identificada
5. Enviar prueba desde Super Admin
6. Salir de la app y enviar mensaje a Alan
7. Confirmar que la notificación llegue en ambos casos

### Detalles técnicos
```text
Problema actual probable

Apple acepta push (201)
        |
        v
Suscripción existe en DB
        |
        v
Service worker activo no coincide con el que maneja "push"
        |
        v
No se ejecuta showNotification()
        |
        v
Super Admin cuenta "éxito", pero iPhone no muestra nada
```

```text
Arquitectura objetivo

1 solo service worker
    ├── install/activate
    ├── push -> showNotification()
    ├── notificationclick
    └── lógica PWA compatible

Cliente
    ├── detecta iOS 16.4+
    ├── detecta modo instalado
    ├── suscribe correctamente
    └── sincroniza una sola suscripción válida
```
