# Mensajes de Audio estilo WhatsApp

## Resumen

Agregar grabacion de audio al chat con reproductor inline en las burbujas de mensaje (como WhatsApp). El usuario graba, el audio queda visible y reproducible en el chat, y Alan recibe la transcripcion para responder.

## Flujo del usuario

1. El usuario mantiene presionado (o toca) el boton de microfono que reemplaza al boton de enviar cuando no hay texto
2. Se graba audio usando MediaRecorder API del navegador
3. Al soltar/detener, el audio se muestra como burbuja de mensaje con reproductor inline
4. En paralelo, se envia el audio a la edge function `transcribe` existente
5. El texto transcripto se envia a Alan como mensaje (invisible para el usuario, que ve solo su burbuja de audio)
6. Alan responde normalmente

## Cambios planificados

### 1. Ampliar tipos de mensaje (`src/lib/stream-chat.ts`)

- Agregar campo opcional `audioUrl?: string` al tipo `Msg` para almacenar la URL del blob de audio en mensajes del usuario

### 2. Hook de grabacion de audio (`src/hooks/use-audio-recorder.ts`) - NUEVO

- Usa `navigator.mediaDevices.getUserMedia` para acceder al microfono
- `MediaRecorder` para grabar en formato `audio/webm` (compatible con navegadores)
- Estados: `idle`, `recording`, `processing`
- Expone: `startRecording()`, `stopRecording()`, `isRecording`, `isTranscribing`
- Al detener, devuelve `{ audioBlob, audioUrl }` via callback
- Funcion `transcribeAudio(blob)` que envia al edge function `/functions/v1/transcribe` y retorna el texto

### 3. Modificar ChatInput (`src/components/ChatInput.tsx`)

- Importar el hook `useAudioRecorder`
- Cuando no hay texto ni adjuntos, mostrar boton de **microfono** en lugar del boton de enviar
- Al presionar el microfono: iniciar grabacion, cambiar UI a estado "grabando" (indicador rojo pulsante + duracion + boton cancelar/enviar)
- Al soltar/confirmar: detener grabacion y llamar `onSendAudio(audioBlob, audioUrl)`
- Nueva prop `onSendAudio` en la interfaz

### 4. Modificar use-chat-messages (`src/hooks/use-chat-messages.ts`)

- Agregar funcion `handleSendAudio(blob: Blob, localUrl: string)`
- Agrega inmediatamente un mensaje de usuario con `audioUrl` y content placeholder `"(mensaje de voz)"`
- Llama a la edge function `transcribe` para obtener el texto
- Actualiza el contenido del mensaje del usuario con el texto transcripto (prefijado con icono de microfono)
- Envia el texto transcripto a `streamChat` para que Alan responda
- Guarda en la DB el texto transcripto (no el audio)

### 5. Componente de reproductor de audio en ChatMessage (`src/components/ChatMessage.tsx`)

- Nuevo sub-componente `AudioBubble` que renderiza:
  - Boton play/pause
  - Barra de progreso animada (estilo WhatsApp)
  - Duracion del audio
  - Indicador de "transcribiendo..." mientras se procesa
- Se muestra cuando `msg.audioUrl` existe
- Usa `HTMLAudioElement` para reproduccion

### 6. Pasar datos de audio por Chat.tsx

- Conectar `onSendAudio` del ChatInput con `handleSendAudio` del hook
- Agregar estado `isTranscribing` al indicador de procesamiento

## Detalles tecnicos

- **Formato de audio**: `audio/webm;codecs=opus` (nativo del navegador), se convierte a WAV antes de enviar al transcribe function si es necesario, o se envia como webm ya que Gemini lo soporta
- **Almacenamiento**: El audio NO se persiste en la DB/storage; solo se mantiene como blob URL en la sesion actual. Al recargar, se ve el texto transcripto
- **Permisos**: Se solicita permiso de microfono al primer uso; si se deniega se muestra toast de error
- **Limite**: Maximo 2 minutos de grabacion (auto-stop)
- **Edge function transcribe**: Ya existe y funciona con Gemini, solo hay que asegurarse de que acepte webm ademas de wav (el formato se pasa como parametro)

# Sistema de Supervisión de Respuestas de Alan ✅

## Implementado

- **Tabla `supervisor_logs`**: Almacena cada evaluación (veredicto, score, motivo, reintentos, latencia)
- **Capa de supervisión en `chat/index.ts`**: Usa `gemini-2.5-flash-lite` para evaluar respuestas antes de enviarlas. Máx 2 reintentos si rechazada. Fail-open si el supervisor falla.
- **Acciones en `admin-stats`**: `supervisor-stats` y `supervisor-logs` para consultar datos
- **Pestaña "Supervisor" en Super Admin**: KPIs, gráfico de 30 días, tabla de logs con detalle expandible, filtros y exportación CSV
