

## Fix: Audio transcription failing with "Invalid audio format"

### Root Cause

The Gemini OpenAI-compatible endpoint (`/v1beta/openai/chat/completions`) with `input_audio` only accepts `wav` and `mp3` as format values. Safari/iOS records audio as `mp4`, and some browsers use `ogg` or `webm` — all of which Gemini rejects with a 400 error.

### Solution

Switch from the OpenAI-compatible endpoint to the **native Gemini API** (`/v1beta/models/gemini-2.5-flash:generateContent`), which accepts audio via `inlineData` with standard MIME types (`audio/webm`, `audio/mp4`, `audio/ogg`, etc.) without the `wav`/`mp3` restriction.

### Changes

**File:** `supabase/functions/transcribe/index.ts`

- Replace the OpenAI-compatible API call with the native Gemini `generateContent` endpoint
- Send audio as `inlineData` with the actual MIME type (e.g., `audio/mp4`, `audio/webm`) instead of a restricted `format` string
- Parse the native Gemini response format (`candidates[0].content.parts[0].text`)
- No frontend changes needed — the issue is entirely in the edge function

