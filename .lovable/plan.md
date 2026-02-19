
# Alan - Asistente IA para Agentes Remax Argentina 🏠

## Visión General
Una plataforma de chat móvil-first donde los agentes de Remax Argentina interactúan con "Alan", un asistente de IA especializado en búsqueda y gestión de propiedades inmobiliarias. La base de datos de propiedades se actualiza automáticamente cada noche mediante scraping.

---

## 1. Autenticación con Google
- Pantalla de login minimalista con branding Remax y botón "Iniciar sesión con Google"
- Perfil de usuario básico (nombre, avatar de Google)
- Sesión persistente

## 2. Interfaz de Chat (100% Mobile-Optimized)
- Diseño tipo WhatsApp/iMessage optimizado para móvil
- Lista de conversaciones anteriores en una vista lateral o pantalla inicial
- Chat con burbujas de mensajes diferenciadas (usuario vs Alan)
- Input de texto con botón de envío en la parte inferior
- Streaming de respuestas de Alan en tiempo real (token por token)
- Alan se presenta con personalidad amigable y profesional

## 3. Agente IA "Alan" - Funcionalidades
Alan usará Lovable AI (Gemini) con tool-calling para ejecutar acciones:

### a) Búsqueda de propiedades
- Los agentes describen lo que buscan en lenguaje natural (ej: "Necesito un departamento de 2 ambientes en Nueva Córdoba por menos de 100mil dólares")
- Alan busca en la base de datos y muestra tarjetas de propiedades con: foto, título, precio, ubicación, superficie, ambientes y link

### b) Comparación de propiedades
- El agente puede pedir comparar 2 o más propiedades
- Alan muestra una tabla comparativa con los datos clave

### c) Favoritos
- Los agentes pueden pedirle a Alan que guarde una propiedad como favorita
- Pueden pedir ver sus favoritos en cualquier momento

### d) Generación de reportes/fichas
- Alan puede generar un resumen/ficha de una propiedad para compartir con clientes

## 4. Base de Datos de Propiedades
- Tabla de propiedades con todos los campos del scraping: external_id, title, operation, price, currency, address, locality, lat/lng, brokers, contact_person, office, dimensiones, ambientes, baños, property_type, url, photo
- Tabla de favoritos por usuario
- Tabla de conversaciones y mensajes

## 5. Scraping Automático Nocturno
- Edge function que se ejecuta automáticamente a las 00:30hs cada noche
- Paso 1: Consulta el endpoint `checkMaxPages` para saber cuántas páginas hay
- Paso 2: Recorre todas las páginas con el endpoint de scraping
- Paso 3: Actualiza la base de datos de propiedades (inserta nuevas, actualiza existentes)
- Proceso 100% invisible para los usuarios

## 6. Historial de Conversaciones
- Todas las conversaciones se guardan de forma persistente
- Los agentes pueden volver a ver conversaciones anteriores
- Cada conversación nueva inicia un nuevo hilo

---

## Stack Técnico
- **Frontend**: React + Tailwind, diseño mobile-first
- **Backend**: Lovable Cloud (Supabase)
- **Auth**: Google OAuth via Supabase Auth
- **IA**: Lovable AI (Gemini) con streaming y tool-calling para búsqueda en DB
- **Scraping**: Edge function + cron job programado a las 00:30hs
