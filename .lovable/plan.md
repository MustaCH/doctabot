

## Aurora Borealis Background for Chat

### What we'll build
A subtle, animated gradient background behind the messages area that evokes a northern lights effect. The animation runs slowly by default and intensifies (brighter colors + faster movement) while Alan is streaming a response, then smoothly decelerates when done.

### Technical approach

**1. CSS Aurora Animation (`src/index.css`)**
- Define a `@keyframes aurora` animation that shifts a large radial/conic gradient background-position through multiple stops
- Use CSS custom properties (`--aurora-speed`, `--aurora-opacity`) to control intensity dynamically
- Light mode: soft blues, teals, and subtle purples at ~0.08 opacity
- Dark mode: slightly more visible at ~0.12 opacity
- Two classes: `.aurora-idle` (slow, 20s cycle, low opacity) and `.aurora-active` (fast, 6s cycle, higher opacity)
- Smooth CSS `transition` on `opacity` and `animation-duration` so state changes feel organic

**2. Aurora overlay element (`src/pages/Chat.tsx`)**
- Add an absolutely-positioned `div` behind the messages scroll area (inside the chat flex column, using `relative` positioning on the parent)
- Apply `pointer-events-none` so it doesn't interfere with scrolling or clicks
- Toggle between `aurora-idle` and `aurora-active` classes based on the `isStreaming` state (already available in the component)
- The gradient div sits at `z-0` with messages at `z-10` (via `relative z-10`)

**3. Implementation details**
- The aurora uses 3-4 overlapping radial gradients with different sizes and positions, animated via `background-position` keyframes
- Colors: primary blue (`hsl(210, 100%, 45%)`), teal (`hsl(170, 60%, 50%)`), soft purple (`hsl(260, 40%, 55%)`) — all at very low opacity
- The transition between idle/active uses CSS `transition: opacity 1.5s ease, animation-duration 1.5s ease` for the organic acceleration/deceleration feel

### Files to modify
- `src/index.css` — Add aurora keyframes and utility classes
- `src/pages/Chat.tsx` — Add aurora background div, toggle class with `isStreaming`

