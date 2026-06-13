# Producto — doctabot (Alan)

> Dueño: Product Strategist. Define qué es el producto, para quién, por qué existe y cómo medimos el éxito. Última actualización: 2026-06-13.

## Qué es

PWA con un asistente de IA conversacional ("Alan") para **agentes inmobiliarios de RE/MAX Docta** (Córdoba, AR). El agente le habla a Alan por texto o voz, y Alan **ejecuta acciones reales** sobre herramientas: buscar propiedades, gestionar el CRM de clientes, agendar en calendario, redactar/enviar email y WhatsApp, y buscar en la web. Corre sobre Gemini.

## Para quién (usuario + JTBD)

**Usuario:** el agente inmobiliario de RE/MAX Docta. No el comprador/vendedor final.

**Jobs To Be Done principales:**
- *"Cuando tengo un comprador buscando, quiero encontrar rápido las propiedades que mejor le calzan para ofrecerle opciones reales y cerrar la venta."*
- *"Cuando interactúo con un cliente, quiero no perder el hilo: que su ficha, su estado y su historial estén a mano sin cargar formularios."*
- *"Cuando aparece una propiedad nueva, quiero enterarme si le sirve a alguno de mis clientes sin tener que cruzar a mano."*

## Por qué existe

El agente inmobiliario pierde tiempo y oportunidades cruzando a mano inventario contra clientes, cargando datos en sistemas separados y redactando mensajes repetitivos. Alan colapsa todo eso en una conversación: el agente pide en lenguaje natural y Alan ejecuta. La diferenciación frente a un CRM tradicional es que **actúa**, no solo almacena.

## Métricas de éxito (propuestas — a validar con Nacho/Marcelo)

- **North Star:** acciones de valor ejecutadas por agente por semana (búsquedas que derivan en contacto, matches enviados a clientes, eventos agendados).
- **Activación:** % de agentes que completan ≥1 acción real con Alan en su primera semana.
- **Retención:** agentes activos semana a semana.
- **Calidad de match:** % de propiedades sugeridas que el agente efectivamente ofrece al cliente (proxy de confianza en el matching).

## Lo que NO es

- **No** es un portal público de propiedades (es herramienta interna del agente).
- **No** reemplaza el sistema de captación/MLS — consume ese inventario.
- **No** es para el comprador/vendedor final: el cliente nunca habla con Alan.
- **No** es un chatbot de FAQ: su valor es ejecutar acciones, no responder preguntas genéricas.

---

## Decisiones de producto

### 2026-06-13 — Matching por zona: "municipio vecino" como fallback etiquetado

**Contexto:** un cliente pidió zona X (San Salvador) y Alan devolvió una propiedad de otro municipio (Falda del Carmen) marcándola como **misma zona** — engañoso, rompe la confianza del agente (ticket 86ah1ekcx, reportado por el cliente). La pregunta de producto: ¿excluir lo de otros municipios, o mostrarlo etiquetado?

**Input del negocio (Marcelo, vía Nacho):**
1. Los agentes **prefieren resultados estrictos** de lo que el cliente pide; pero **si no hay nada exacto, sumar algo vecino está bien**.
2. "Vecino" = lo que **conecta directamente** (adyacencia física real, no radio arbitrario).
3. **No es frecuente**, pero pasa.

**Decisión:** *vecino como fallback etiquetado, no como default.*
- **Default = estricto.** Si hay matches en la zona exacta, Alan muestra solo esos. Cero vecinos mezclados.
- **Fallback = vecino etiquetado.** Si la búsqueda da 0 (o casi 0) resultados en la zona pedida, Alan ofrece propiedades de zonas que **conectan directamente**, siempre marcadas explícitamente como `cercana · municipio vecino` — nunca como misma zona.
- **Alcance:** aplica a la **búsqueda interactiva** de Alan. En `morning-matches` (notificación proactiva) se mantiene **estricto** — mandar un vecino que nadie pidió es ruido.
- **Prioridad:** mejora incremental (baja frecuencia). El bug de "no mentir" (86aj165ed) va primero e independiente.

**Modelo recomendado:** definir "vecino" como **corredores geográficos** (cluster de zonas adyacentes), no como pares 1:1 — más mantenible y refleja "lo que conecta". Una zona es vecina de otra si comparten corredor.

**Borrador de corredores (⚠️ a validar/completar con Marcelo — la asignación fina de cada country la define él):**

| Corredor | Zonas (parcial, confirmar) |
|---|---|
| Capital centro/pericentro | Centro, Nueva Córdoba, Güemes, Observatorio, Alberdi, Alto Alberdi, General Paz, San Vicente, Alta Córdoba, Cofico |
| Capital noroeste | Cerro de las Rosas, Urca, Villa Belgrano, Villa Cabrera, Argüello, Villa Warcalde |
| Sierras Chicas (norte) | La Calera, Saldán, Villa Allende, Mendiolaza, Unquillo, Río Ceballos *(orden desde la capital)* + countries del norte (Lomas de la Carolina, Altos del Chateau, Chacras del Norte, Jardín Claret) |
| Suroeste — countries autopista Carlos Paz | Docta, Valle Escondido, La Rufina, Greenville, Manantiales *(confirmar — hay zonas homónimas en el sur)* |
| Sur — Camino a Alta Gracia (Santa María) | **Falda del Carmen, San Salvador**, Malagueño, Bouwer, Alta Gracia |
| Punilla (sierras oeste) | Villa Carlos Paz |

> Nota: barrios de Capital son contiguos entre sí dentro de su corredor; los countries periurbanos son los que requieren asignación cuidadosa (algunos nombres se repiten entre corredor sur y norte). **Una asignación equivocada de un country a un corredor reintroduce un cross-match falso** — por eso esta tabla NO se implementa sin pasada de validación de Marcelo.

**Pendiente para destrabar implementación:** lista de adyacencias/corredores validada por Marcelo. Hasta entonces, el feature de fallback queda bloqueado por dato (no por decisión — la decisión está tomada).

**Handoff:** PM redefine el AC2 de 86ah1ekcx con esta decisión y crea el ticket del feature (fallback + tabla de corredores), prioridad Normal/Low, bloqueado por la lista de Marcelo. El bug 86aj165ed avanza igual.
