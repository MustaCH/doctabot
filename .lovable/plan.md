

## Plan: arreglar el caso de "código inválido" cuando en realidad es correcto

### Diagnóstico

Revisé el flujo completo y el estado en base de datos:

- En la tabla `invitation_codes` hay **un solo código activo**: `RMX7K2P`
- Hay otro código (`DOCTA1`) marcado como **inactivo**, así que si alguien intenta usarlo, el sistema responde "inválido" (correcto, pero el mensaje no lo aclara)
- La función `validate_invitation_code` ya normaliza con `UPPER(TRIM(...))`, así que mayúsculas/minúsculas y espacios al borde no son el problema
- El cliente también hace `.trim()` antes de mandarlo

Entonces, si el usuario juraba haber ingresado el código correcto, las causas más probables son:

1. **Caracteres invisibles pegados desde WhatsApp/email**: espacios no-break (`\u00A0`), comillas curvas, guiones largos, zero-width spaces. El `TRIM` de SQL **no** los elimina.
2. **Confusión visual**: `0` (cero) vs `O` (letra), `1` vs `I` vs `l`. El código `RMX7K2P` tiene un `7` y un `2` que pueden leerse mal en algunas fuentes.
3. **Código desactivado o equivocado**: usó `DOCTA1` (que está inactivo) o un código que ya no existe, y el mensaje genérico no lo distingue.
4. **Falta de feedback en pantalla**: el toast desaparece y el usuario no ve qué se está enviando exactamente.

### Qué se va a implementar

#### 1. Normalización agresiva en el cliente antes de enviar
En `Onboarding.tsx`, antes de mandar el código a la RPC:

- Eliminar **todos** los espacios (incluidos `\u00A0`, tabs, zero-width)
- Eliminar caracteres invisibles comunes pegados desde mensajería
- Convertir a mayúsculas
- Reemplazar caracteres "parecidos" típicos de copy-paste: comillas curvas, guion largo

Así, si el usuario pega `RMX 7K2P` o `RMX7K2P​` (con zero-width al final), igual entra.

#### 2. Misma normalización en la función SQL
Actualizar `validate_invitation_code` para hacer `regexp_replace` y dejar solo `[A-Z0-9]` antes de comparar, en ambos lados (input y código guardado). Esto cubre el caso aunque el cliente no normalice.

#### 3. Mensajes de error más claros
En vez de solo "Código inválido":

- Si el código no existe en la tabla → "Código no reconocido. Verificá que sea exactamente el que te pasó tu broker."
- Si existe pero está `is_active = false` → "Este código ya no está vigente. Pedile uno nuevo a tu broker."
- Mostrar también, debajo del input, el código **tal cual** lo está por enviar el sistema (ya normalizado), para que el usuario vea qué se está validando.

Esto requiere que la RPC devuelva más contexto. Se va a crear una segunda función que retorna un estado: `valid`, `inactive`, `not_found`.

#### 4. Mejoras de UX en el input
- `autoCapitalize="characters"` + `autoCorrect="off"` + `spellCheck={false}` + `inputMode="text"` para evitar que iOS/Android lo "ayuden" mal
- Mostrar el valor normalizado en vivo abajo del input (gris chico): "Se enviará: `RMX7K2P`"
- Botón de "Pegar" que aplique la normalización, útil en mobile

#### 5. Log opcional para debug
Registrar en una tabla simple cada intento fallido (qué `input_code` exacto, en bytes, llegó al servidor) durante unos días, para ver si hay un patrón concreto. Esto se puede hacer dentro de la nueva función SQL. Útil para detectar rápido si un usuario futuro vuelve a tener el problema.

### Archivos a tocar

- `src/pages/Onboarding.tsx` — normalización del input, mensajes nuevos, mostrar valor normalizado, atributos del input
- nueva migración SQL — reemplazar `validate_invitation_code` por una versión que retorne estado (`valid` / `inactive` / `not_found`) y normalice agresivamente, y opcionalmente crear `invitation_attempts` para logging
- `src/integrations/supabase/types.ts` — se regenera solo

### Verificación

Después de aplicar, vamos a probar estos casos:

1. `RMX7K2P` → válido
2. ` RMX7K2P ` (espacios) → válido
3. `rmx7k2p` (minúsculas) → válido
4. `RMX 7K2P` (espacio en medio) → válido
5. `RMX7K2P` con zero-width al final pegado desde WhatsApp → válido
6. `DOCTA1` → mensaje específico "código ya no vigente"
7. `XXXXXXX` → mensaje específico "código no reconocido"

### Detalles técnicos

```text
Flujo actual

input usuario
    └─ trim() en cliente
        └─ RPC validate_invitation_code
            └─ UPPER(TRIM(...)) en SQL
                └─ devuelve true / false
                    └─ "Código inválido" (mensaje único)

Flujo objetivo

input usuario
    └─ normalize_strict() en cliente (mayúsculas, sin espacios, sin invisibles)
        └─ mostrar valor normalizado en pantalla
            └─ RPC validate_invitation_code_v2
                └─ regexp_replace a [A-Z0-9]
                    └─ devuelve { status: 'valid' | 'inactive' | 'not_found' }
                        └─ mensaje específico al usuario
```

### Pregunta abierta para vos

Mientras tanto, si querés desbloquear al usuario ya:

- ¿Querés que active también `DOCTA1` por las dudas, o lo dejamos solo con `RMX7K2P`?
- ¿Sabés exactamente qué texto pegó el usuario (capturita)? Si lo tenés, lo puedo correr contra la lógica nueva y confirmar al toque que el fix lo cubre.

